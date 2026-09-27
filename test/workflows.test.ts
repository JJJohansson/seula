import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const WORKFLOW = readFileSync(join(import.meta.dirname, "..", ".github", "workflows", "ticket-to-spec.yml"), "utf8").replace(/\r\n/g, "\n");

/** The text of the step whose `name:` starts with `name`, up to the next step. */
function step(name: string): string {
  const lines = WORKFLOW.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`      - name: ${name}`));
  assert.ok(start >= 0, `step "${name}" not found`);
  let end = start + 1;
  while (end < lines.length && !/^ {6}- |^\S/.test(lines[end] ?? "")) end++;
  return lines.slice(start, end).join("\n");
}

/** The `run: |` script of a step, dedented. */
function script(name: string): string {
  const lines = step(name).split("\n");
  const at = lines.findIndex((l) => l.trim() === "run: |");
  assert.ok(at >= 0, `step "${name}" has no run block`);
  return lines.slice(at + 1).map((l) => l.slice(10)).join("\n");
}

const stepNames = (): string[] => [...WORKFLOW.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1] ?? "");

const AGENT = "Write the spec";

test("ticket-to-spec criterion 6: the repo checkout stores no credential", () => {
  assert.match(step("Check out the repo"), /persist-credentials: false/);
  assert.match(step("Check out seula"), /persist-credentials: false/);
});

test("ticket-to-spec criterion 6: the agent's step gets no GitHub or Jira secret", () => {
  const agent = step(AGENT);
  for (const secret of ["SEULA_GH_TOKEN", "JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"]) {
    assert.doesNotMatch(agent, new RegExp(secret));
  }
});

test("ticket-to-spec criterion 6: only the pull request step pushes, with its own token", () => {
  const pushers = stepNames().filter((n) => /git\S* push|git_auth push/.test(step(n)));
  assert.deepEqual(pushers, ["Commit and open the pull request (criterion 7)"]);
  const pr = step("Commit and open the pull request");
  assert.match(pr, /add-mask/);
  assert.doesNotMatch(script("Commit and open the pull request"), /^git push/m);
});

test("ticket-to-spec criterion 6: no ${{ }} expression inside a run script", () => {
  for (const name of stepNames()) {
    if (!/run: \|/.test(step(name))) continue;
    assert.doesNotMatch(script(name), /\$\{\{/, `step "${name}"`);
  }
});

test("ticket-to-spec criterion 5: the agent reads only its working directory and skills", () => {
  const agent = step(AGENT);
  const allowed = /--allowedTools "([^"]+)"/.exec(agent)?.[1]?.split(",") ?? [];
  assert.ok(allowed.length > 0, "no --allowedTools");
  for (const bare of ["Read", "Glob", "Grep", "Bash"]) {
    assert.ok(!allowed.includes(bare), `bare ${bare} allows reads anywhere`);
  }
  assert.match(agent, /blockReadsOutsideWorkingDirectories\\?"?:\s*true/);
  assert.match(agent, /--add-dir "\$HOME\/\.claude\/skills"/);
});

test("ticket-to-spec criterion 5: the agent edits only the spec directory and runs only G1", () => {
  const allowed = /--allowedTools "([^"]+)"/.exec(step(AGENT))?.[1]?.split(",") ?? [];
  const edits = allowed.filter((t) => /^(Edit|Write)/.test(t));
  assert.deepEqual(edits, ["Edit($SPEC_DIR/**)"]);
  const shell = allowed.filter((t) => t.startsWith("Bash"));
  assert.deepEqual(shell, ["Bash($SEULA gate g1 *)"]);
  const denied = /--disallowedTools "([^"]+)"/.exec(step(AGENT))?.[1]?.split(",") ?? [];
  for (const t of ["WebFetch", "WebSearch", "Bash(git *)"]) assert.ok(denied.includes(t), `${t} not denied`);
});

test("ticket-to-spec criterion 5: the agent's shell commands can't see the Anthropic key", () => {
  assert.match(step(AGENT), /CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1"/);
});

test("ticket-to-spec criterion 14: the repo's Claude Code settings, hooks and project skills don't load", () => {
  // Without project and local sources, Claude Code reads no .claude/settings*.json, .mcp.json,
  // project skills or subagents. User sources keep the installed skills.
  const sources = /--setting-sources (\S+)/.exec(step(AGENT))?.[1]?.split(",") ?? [];
  assert.deepEqual(sources, ["user"]);
});

test("ticket-to-spec criterion 8: a skipped G1 counts as ready only without a Jev key", () => {
  const result = step("Read the result");
  assert.match(result, /HAS_JEV: \$\{\{ secrets\.TYPESAFE_API_KEY != '' \}\}/);
  assert.match(script("Read the result"), /"\$g1" = "skipped" \] && \[ "\$HAS_JEV" != "true" \]/);
});

test("ticket-to-spec criterion 13: the secret check runs before anything is committed or posted", () => {
  const names = stepNames();
  const scan = names.findIndex((n) => n.startsWith("Check the agent's output for secrets"));
  assert.ok(scan >= 0, "no secret check step");
  assert.ok(scan < names.findIndex((n) => n.startsWith("Commit and open the pull request")));
  assert.ok(scan < names.findIndex((n) => n.startsWith("Report on the ticket")));
  const env = step("Check the agent's output for secrets");
  for (const secret of ["ANTHROPIC_API_KEY", "TYPESAFE_API_KEY", "SEULA_GH_TOKEN", "JIRA_API_TOKEN"]) {
    assert.match(env, new RegExp(`${secret}: \\$\\{\\{ secrets\\.${secret} \\}\\}`));
  }
  // Later steps have no always() or failure(), so a failed check stops them.
  for (const later of ["Commit and open the pull request", "Report on the ticket"]) {
    assert.doesNotMatch(step(later), /if: .*(always|failure)\(\)/);
  }
});

const hasBash = process.platform !== "win32" && spawnSync("bash", ["--version"]).status === 0;

function runScan(files: Record<string, string>, env: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), "seula-scan-"));
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(d, f, ".."), { recursive: true });
    writeFileSync(join(d, f), c);
  }
  return spawnSync("bash", ["-euo", "pipefail", "-c", script("Check the agent's output for secrets")], {
    cwd: d,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", SPEC_DIR: "specs", RUN_FILE: ".seula/runs/T-1.json", ...env },
  });
}

test("ticket-to-spec criterion 13: a secret in the spec stops the run and is not printed", { skip: !hasBash && "needs bash" }, () => {
  const secret = "sk-ant-fake-0123456789";
  const r = runScan(
    { "specs/a.md": `# A\n${secret}\n`, ".seula/runs/T-1.json": "{}", "claude.json": "{}" },
    { ANTHROPIC_API_KEY: secret },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /ANTHROPIC_API_KEY/);
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(secret));
});

test("ticket-to-spec criterion 13: a secret in the agent's output stops the run", { skip: !hasBash && "needs bash" }, () => {
  const r = runScan(
    { "specs/a.md": "# A\n", ".seula/runs/T-1.json": "{}", "claude.json": '{"summary":"jev-key-0123456789"}' },
    { TYPESAFE_API_KEY: "jev-key-0123456789" },
  );
  assert.notEqual(r.status, 0);
});

test("ticket-to-spec criterion 13: clean output passes, and unset or empty secrets are ignored", { skip: !hasBash && "needs bash" }, () => {
  const r = runScan(
    { "specs/a.md": "# A\n", ".seula/runs/T-1.json": "{}", "claude.json": "{}" },
    { ANTHROPIC_API_KEY: "sk-ant-fake-0123456789", JIRA_API_TOKEN: "" },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// Claude Code 2.1.257 is the first version with permissions.blockReadsOutsideWorkingDirectories,
// the newest setting that the agent's step relies on (criterion 5).
const MIN_CLAUDE_CODE = [2, 1, 257];

test("security criterion 2: Claude Code is installed at an exact version that supports the agent's settings", () => {
  const install = /npm install -g @anthropic-ai\/claude-code(\S*)/.exec(script("Install Claude Code"));
  assert.ok(install, "no Claude Code install");
  const version = /^@(\d+)\.(\d+)\.(\d+)$/.exec(install[1] ?? "");
  assert.ok(version, `not pinned to an exact version: "@anthropic-ai/claude-code${install[1]}"`);
  const asNumber = (parts: number[]) => parts.reduce((n, part) => n * 10_000 + part, 0);
  const v = version.slice(1).map(Number);
  const atLeast = asNumber(v) >= asNumber(MIN_CLAUDE_CODE);
  assert.ok(atLeast, `Claude Code ${v.join(".")} is older than ${MIN_CLAUDE_CODE.join(".")}`);
});

test("ticket-to-spec criterion 5: the sandbox for the agent's shell commands can start on the runner", () => {
  // With CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1, Claude Code runs every agent command in a bubblewrap
  // sandbox and refuses to start without it (first real run, 2026-09-27).
  const install = script("Install Claude Code");
  assert.match(install, /apt-get install -y[^\n]*\bbubblewrap\b/);
  assert.match(install, /apt-get install -y[^\n]*\bsocat\b/);
  // Ubuntu 24.04 blocks unprivileged user namespaces; the documented profile unconfines only bwrap.
  assert.match(install, /kernel\.apparmor_restrict_unprivileged_userns/);
  assert.match(install, /profile bwrap \/usr\/bin\/bwrap flags=\(unconfined\)/);
  assert.match(install, /systemctl reload apparmor/);
  // A self-test fails the step with a clear message instead of a blocked run later.
  assert.match(install, /bwrap [^\n]*--unshare-user[^\n]*true/);
  assert.ok(install.indexOf("bubblewrap") < install.indexOf("npm install -g @anthropic-ai/claude-code"));
});

test("ticket-to-spec criteria 5-6: the agent's step gets no Jev key and its commands no network", () => {
  // Masking the key needs the sandbox proxy to terminate TLS, which was unavailable on the runner
  // (third real run, 2026-09-27). The key is removed instead; the workflow runs G1 with Jev itself.
  // Criterion 6: the agent's step no longer uses Jev, so it doesn't get the key at all.
  assert.doesNotMatch(step(AGENT), /TYPESAFE_API_KEY/);
  const agent = script(AGENT);
  assert.match(agent, /blockReadsOutsideWorkingDirectories/);
  assert.doesNotMatch(agent, /allowedDomains|tlsTerminate|"mask"|jev_host/);
  assert.doesNotMatch(step(AGENT), /NODE_USE_ENV_PROXY/);
});

const OWN_G1 = "G1 · the workflow's own check";

test("ticket-to-spec criterion 15: after the agent, the workflow runs G1 with the Jev key on the returned spec", () => {
  const names = stepNames();
  const own = names.findIndex((n) => n.startsWith(OWN_G1));
  assert.ok(own >= 0, "no workflow G1 step");
  assert.ok(names.findIndex((n) => n.startsWith(AGENT)) < own, "must run after the agent");
  assert.ok(own < names.findIndex((n) => n.startsWith("Read the result")), "must run before the result is read");
  const s = step(OWN_G1);
  assert.match(s, /TYPESAFE_API_KEY: \$\{\{ secrets\.TYPESAFE_API_KEY \}\}/);
  assert.doesNotMatch(s, /ANTHROPIC_API_KEY|SEULA_GH_TOKEN|JIRA_/);
  const run = script(OWN_G1);
  // It records the result in the run file, so criterion 8 reads it as the last G1 result.
  assert.ok(run.includes('$SEULA gate g1 "$spec" --run "$RUN_ID" --ticket "$TICKET_FILE"'));
  // Only a valid spec path in the spec directory is checked.
  assert.ok(run.includes("^[a-z0-9][a-z0-9-]*\\.md$"));
  // back (1), unsure (2) and the loop limit (3) are results, not step failures.
  assert.ok(run.includes("set +e"));
});

test("ticket-to-spec criterion 9: when G1 sends the spec back, its feedback goes on the ticket too", () => {
  const report = script("Report on the ticket");
  assert.ok(report.includes('[.events[] | select(.gate == "G1")] | last | .feedback'));
});

test("ticket-to-spec criterion 7: the pull request links the ticket once and shows rounded costs", () => {
  const pr = script("Commit and open the pull request");
  assert.doesNotMatch(pr, /\$\{ticket_link:-/, "a :- expansion prints the link a second time");
  assert.match(pr, /ticket_ref="\[\$TICKET_KEY\]\(\$ticket_link\)"/);
  assert.match(pr, /claudeUsd \* 100 \| round \/ 100/);
});

// Unsure criteria are for the spec reviewer, not the ticket author (fifth real run, 2026-09-27:
// G1 passed 10 criteria and was unsure about 2, and MEAL-1 went to Needs input).
test("ticket-to-spec criterion 8: an unsure G1 with no open questions is a review, not needs input", () => {
  const result = script("Read the result");
  assert.ok(result.includes('if [ "$status" = "ready" ] && [ "$g1" = "review" ]; then'));
  assert.ok(result.includes("status=review"));
});

test("ticket-to-spec criterion 8: only needs_input and blocked open a draft; an updated PR follows the result", () => {
  const pr = script("Commit and open the pull request");
  assert.ok(pr.includes('if [ "$STATUS" != "ready" ] && [ "$STATUS" != "review" ]; then draft=(--draft); fi'));
  assert.ok(pr.includes('gh pr ready "$branch" --undo'), "an updated PR goes back to draft when not ready");
  assert.match(pr, /gh pr ready "\$branch"( \|\||$)/m);
  assert.ok(pr.includes("## Needs your judgement"));
});

test("ticket-to-spec criterion 9: a review moves the ticket to spec review and lists the unsure criteria", () => {
  const report = script("Report on the ticket");
  assert.ok(report.includes('elif [ "$STATUS" = "review" ]; then'));
  assert.ok(report.includes("→ review"), "lists the criteria G1 was unsure about");
});

const hasJq = hasBash && spawnSync("jq", ["--version"]).status === 0;

function readResultOutputs(opts: { status: string; g1: string; hasJev?: string; questions?: string[]; claudeExit?: string; specPath?: string }): Record<string, string> {
  const d = mkdtempSync(join(tmpdir(), "seula-result-"));
  mkdirSync(join(d, "specs"));
  mkdirSync(join(d, ".seula", "runs"), { recursive: true });
  writeFileSync(join(d, "specs", "a.md"), "# A\n");
  writeFileSync(join(d, "claude.json"), JSON.stringify({ structured_output: { spec_path: opts.specPath ?? "specs/a.md", status: opts.status, questions: opts.questions ?? [], summary: "" } }));
  writeFileSync(join(d, ".seula", "runs", "T-1.json"), JSON.stringify({ events: [{ gate: "G1", result: "skipped" }, { gate: "G1", result: opts.g1 }] }));
  writeFileSync(join(d, "out.txt"), "");
  const r = spawnSync("bash", ["-eo", "pipefail", "-c", script("Read the result")], {
    cwd: d,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", SEULA: "true", RUN_ID: "T-1", RUN_FILE: ".seula/runs/T-1.json", SPEC_DIR: "specs", CLAUDE_EXIT: opts.claudeExit ?? "0", HAS_JEV: opts.hasJev ?? "true", GITHUB_OUTPUT: join(d, "out.txt") },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const lines = readFileSync(join(d, "out.txt"), "utf8").trim().split("\n");
  return Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
}

const readResult = (opts: Parameters<typeof readResultOutputs>[0]): string => readResultOutputs(opts).status ?? "";

test("ticket-to-spec criterion 8: the routing table, run with bash", { skip: !hasJq && "needs bash and jq" }, () => {
  assert.equal(readResult({ status: "ready", g1: "pass" }), "ready");
  assert.equal(readResult({ status: "ready", g1: "review" }), "review");
  assert.equal(readResult({ status: "ready", g1: "back" }), "needs_input");
  assert.equal(readResult({ status: "ready", g1: "skipped" }), "needs_input", "a lost Jev key never passes");
  assert.equal(readResult({ status: "ready", g1: "skipped", hasJev: "false" }), "ready");
  assert.equal(readResult({ status: "needs_input", g1: "review", questions: ["q"] }), "needs_input", "open questions go to the author");
});

// First real run (2026-09-27, MEAL-1): Claude Code couldn't start, and the ticket went to Needs
// input with "the spec needs input (blocked)", which its author couldn't act on.
const FAILURE = "Report a failure on the ticket";

test("ticket-to-spec criterion 17: a Claude error or no valid spec path is a failure with no pull request", { skip: !hasJq && "needs bash and jq" }, () => {
  const crashed = readResultOutputs({ status: "ready", g1: "pass", claudeExit: "1" });
  assert.equal(crashed.status, "failed", "Claude exiting with an error (the turn cap included)");
  assert.equal(crashed.spec, "", "no pull request, even if the agent wrote a file");
  const noPath = readResultOutputs({ status: "ready", g1: "pass", specPath: "" });
  assert.equal(noPath.status, "failed");
  assert.equal(noPath.spec, "");
  assert.equal(readResult({ status: "ready", g1: "pass", specPath: "../outside.md" }), "failed");
  // G1's loop limit is a result about the spec, not a technical failure (criteria 8-9).
  assert.equal(readResult({ status: "blocked", g1: "back" }), "blocked");
});

test("ticket-to-spec criterion 17: a failure gets its own report, and the normal report skips it", () => {
  const names = stepNames();
  const failure = names.findIndex((n) => n.startsWith(FAILURE));
  assert.ok(failure >= 0, "no failure report step");
  assert.ok(names.findIndex((n) => n.startsWith("Report on the ticket")) < failure, "runs after the normal report");
  assert.ok(failure < names.findIndex((n) => n === "Summary"), "runs before the summary");
  const cond = /^ {8}if: (.+)$/m.exec(step(FAILURE))?.[1] ?? "";
  for (const part of ["failure()", "cancelled()", "steps.result.outputs.status == 'failed'"]) {
    assert.ok(cond.includes(part), `the condition lacks ${part}`);
  }
  assert.match(step("Report on the ticket"), /if: .*steps\.result\.outputs\.status != 'failed'/);
  assert.match(script("Summary"), /"\$STATUS" = "failed"/);
});

test("ticket-to-spec criteria 13, 17: the failure report posts no agent output and doesn't move the ticket", () => {
  const s = step(FAILURE);
  const run = script(FAILURE);
  for (const output of ["claude.json", "RUN_FILE", "g0.json", "ticket.json", "SPEC_DIR"]) {
    assert.ok(!run.includes(output), `reads ${output}`);
  }
  assert.doesNotMatch(run, /tracker move/);
  assert.doesNotMatch(s, /ANTHROPIC_API_KEY|TYPESAFE_API_KEY/);
});

function reportFailure(env: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), "seula-failure-"));
  const bin = join(d, "bin");
  mkdirSync(bin);
  // A stand-in for seula: records its arguments and the comment it would post.
  writeFileSync(join(bin, "seula"), `#!/usr/bin/env bash\necho "$*" >> "${d}/calls.txt"\nwhile [ $# -gt 0 ]; do if [ "$1" = --text-file ]; then cat "$2" >> "${d}/posted.txt"; fi; shift; done\n`, { mode: 0o755 });
  const r = spawnSync("bash", ["-eo", "pipefail", "-c", script(FAILURE)], {
    cwd: d,
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH ?? ""}`, SEULA: "seula", SEULA_TRACKER: "jira", GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "42", ...env },
  });
  const read = (f: string) => { try { return readFileSync(join(d, f), "utf8"); } catch { return ""; } };
  return { r, calls: read("calls.txt"), posted: read("posted.txt") };
}

test("ticket-to-spec criterion 17: the failure comment says seula failed and links the run", { skip: !hasBash && "needs bash" }, () => {
  const { r, calls, posted } = reportFailure({ TICKET_KEY: "MEAL-9" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(calls, /^tracker comment --tracker jira --key MEAL-9 --text-file /m);
  assert.doesNotMatch(calls, /tracker move/);
  assert.match(posted, /seula failed to run/);
  assert.ok(posted.includes("https://github.com/o/r/actions/runs/42"));
  assert.match(posted, /re-run/i, "says how to start it again");
});

test("ticket-to-spec criterion 17: with no ticket key, the failure report posts nothing and doesn't fail", { skip: !hasBash && "needs bash" }, () => {
  const { r, calls } = reportFailure({});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(calls, "");
});

// Sixth real run (2026-09-27, MEAL-3): the retry started from main, didn't see its own new draft
// spec, wrote another with a different name, and opened a second pull request.
const EARLIER = "Find an earlier run for this ticket";

test("ticket-to-spec criterion 16: the branch is named after the ticket, or reuses the ticket's open PR branch", () => {
  const find = script(EARLIER);
  assert.ok(find.includes('branch="seula/$key_lc"'));
  assert.ok(find.includes('select(. == $b or startswith($b + "-"))'), "reuses an open branch of this ticket, also old-style names");
  const pr = script("Commit and open the pull request");
  assert.ok(pr.includes('branch="$BRANCH"'));
  assert.doesNotMatch(pr, /basename "\$SPEC"/, "the spec's name no longer picks the branch");
});

test("ticket-to-spec criterion 16: the agent gets the spec an earlier run added, and only that", () => {
  const names = stepNames();
  const find = names.findIndex((n) => n.startsWith(EARLIER));
  assert.ok(find >= 0 && find < names.findIndex((n) => n.startsWith(AGENT)), "runs before the agent");
  const run = script(EARLIER);
  assert.ok(run.includes("--diff-filter=A"), "only files the branch added, so main's newer files are kept");
  assert.ok(run.includes('git checkout "origin/$branch" -- "$previous"'));
  assert.ok(script(AGENT).includes("--previous-spec"));
  // It reads the branch with the bot token, in this step only; the agent's step still has none.
  assert.match(step(EARLIER), /GH_TOKEN: \$\{\{ secrets\.SEULA_GH_TOKEN \}\}/);
  assert.doesNotMatch(step(AGENT), /SEULA_GH_TOKEN/);
});

test("ticket-to-spec criterion 16: a pull request never holds two specs for one ticket", () => {
  const result = script("Read the result");
  assert.ok(result.includes('if [ -n "${PREVIOUS_SPEC:-}" ] && [ -n "$spec" ] && [ "$spec" != "$PREVIOUS_SPEC" ]; then'));
  assert.ok(result.includes('rm -f -- "$PREVIOUS_SPEC"'));
});

function earlierRun(openBranches: string[]) {
  const d = mkdtempSync(join(tmpdir(), "seula-earlier-"));
  const origin = join(d, "origin.git");
  const work = join(d, "work");
  const bin = join(d, "bin");
  mkdirSync(bin);
  // A stand-in for gh: lists the given open pull request branches.
  writeFileSync(join(bin, "gh"), `#!/usr/bin/env bash\necho '${JSON.stringify(openBranches.map((b) => ({ headRefName: b })))}'\n`, { mode: 0o755 });
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  spawnSync("git", ["init", "-q", "--bare", origin]);
  mkdirSync(work);
  git(work, "init", "-q", "-b", "main");
  mkdirSync(join(work, "specs"));
  writeFileSync(join(work, "specs", "README.md"), "index v1\n");
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", "base");
  git(work, "remote", "add", "origin", origin);
  // An earlier run's branch: adds a draft spec and changes the index.
  git(work, "checkout", "-q", "-b", "seula/meal-3-copy-ingredients");
  writeFileSync(join(work, "specs", "copy-ingredients.md"), "# draft\n");
  writeFileSync(join(work, "specs", "README.md"), "index from the branch\n");
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", "draft");
  git(work, "push", "-q", "origin", "seula/meal-3-copy-ingredients");
  // Meanwhile the base branch moves on.
  git(work, "checkout", "-q", "main");
  writeFileSync(join(work, "specs", "README.md"), "index v2 on main\n");
  git(work, "commit", "-q", "-am", "main moves on");
  const envFile = join(d, "env.txt");
  writeFileSync(envFile, "");
  const r = spawnSync("bash", ["-eo", "pipefail", "-c", script(EARLIER)], {
    cwd: work,
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH ?? ""}`, GH_TOKEN: "x", RUN_ID: "MEAL-3", SPEC_DIR: "specs", GITHUB_ENV: envFile },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const env = Object.fromEntries(readFileSync(envFile, "utf8").trim().split("\n").map((l) => l.split("=")));
  return { env, work };
}

test("ticket-to-spec criterion 16: a retry reuses the ticket's branch and gets back only its own draft", { skip: !hasJq && "needs bash, jq and git" }, () => {
  const { env, work } = earlierRun(["seula/meal-3-copy-ingredients", "seula/meal-30"]);
  assert.equal(env.BRANCH, "seula/meal-3-copy-ingredients");
  assert.equal(env.PREVIOUS_SPEC, "specs/copy-ingredients.md");
  assert.equal(readFileSync(join(work, "specs", "copy-ingredients.md"), "utf8"), "# draft\n");
  assert.equal(readFileSync(join(work, "specs", "README.md"), "utf8"), "index v2 on main\n", "main's newer index is kept");
});

test("ticket-to-spec criterion 16: a first run uses seula/<key>, and another ticket's branch is not taken", { skip: !hasJq && "needs bash, jq and git" }, () => {
  const { env } = earlierRun(["seula/meal-30"]);
  assert.equal(env.BRANCH, "seula/meal-3");
  assert.equal(env.PREVIOUS_SPEC ?? "", "");
});
