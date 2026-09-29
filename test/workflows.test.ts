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

function readResultOutputs(opts: { status: string; g1: string; hasJev?: string; questions?: string[]; claudeExit?: string; specPath?: string; claude?: Record<string, unknown> | string }): Record<string, string> {
  const d = mkdtempSync(join(tmpdir(), "seula-result-"));
  mkdirSync(join(d, "specs"));
  mkdirSync(join(d, ".seula", "runs"), { recursive: true });
  writeFileSync(join(d, "specs", "a.md"), "# A\n");
  const output = { structured_output: { spec_path: opts.specPath ?? "specs/a.md", status: opts.status, questions: opts.questions ?? [], summary: "" } };
  writeFileSync(join(d, "claude.json"), typeof opts.claude === "string" ? opts.claude : JSON.stringify({ ...output, ...opts.claude }));
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

test("ticket-to-spec criterion 17: the result names the kind of failure from a fixed list", { skip: !hasJq && "needs bash and jq" }, () => {
  const reason = (opts: Parameters<typeof readResultOutputs>[0]) => readResultOutputs(opts).reason ?? "";
  assert.equal(reason({ status: "ready", g1: "pass" }), "", "no failure, no reason");
  assert.equal(reason({ status: "ready", g1: "pass", claudeExit: "1", claude: { subtype: "error_max_turns", is_error: true } }), "turn_cap");
  // The turn cap can also end with exit 0 and no structured output.
  assert.equal(reason({ status: "", g1: "pass", specPath: "", claude: { subtype: "error_max_turns" } }), "turn_cap");
  assert.equal(reason({ status: "ready", g1: "pass", claudeExit: "1", claude: { is_error: true, result: "API Error: 529 overloaded" } }), "claude_api");
  assert.equal(reason({ status: "ready", g1: "pass", claudeExit: "1", claude: "not json" }), "claude_other");
  assert.equal(reason({ status: "ready", g1: "pass", specPath: "" }), "no_spec");
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
  // It names these keys when they are refused (criterion 27), but never gets their values.
  assert.doesNotMatch(s, /secrets\.(ANTHROPIC_API_KEY|TYPESAFE_API_KEY)/);
});

function reportFailure(env: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), "seula-failure-"));
  const bin = join(d, "bin");
  mkdirSync(bin);
  // A stand-in for seula: records its arguments and the comment it would post.
  // FAKE_SEULA_EXIT makes it fail, e.g. 77 when the tracker refuses the credential.
  writeFileSync(join(bin, "seula"), `#!/usr/bin/env bash\necho "$*" >> "${d}/calls.txt"\nwhile [ $# -gt 0 ]; do if [ "$1" = --text-file ]; then cat "$2" >> "${d}/posted.txt"; fi; shift; done\nexit "\${FAKE_SEULA_EXIT:-0}"\n`, { mode: 0o755 });
  const r = spawnSync("bash", ["-eo", "pipefail", "-c", script(FAILURE)], {
    cwd: d,
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH ?? ""}`, SEULA: "seula", SEULA_TRACKER: "jira", GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "42", GITHUB_STEP_SUMMARY: join(d, "summary.md"), ...env },
  });
  const read = (f: string) => { try { return readFileSync(join(d, f), "utf8"); } catch { return ""; } };
  return { r, calls: read("calls.txt"), posted: read("posted.txt"), summary: read("summary.md") };
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

/** The steps the failure report names, as "OUTCOME_VAR|step name" pairs in its script. */
function reportedSteps(): { variable: string; name: string }[] {
  return [...script(FAILURE).matchAll(/^ {2}"(OUT_[A-Z0-9_]+)\|([^"]+)"$/gm)].map((m) => ({ variable: m[1] ?? "", name: m[2] ?? "" }));
}

test("ticket-to-spec criterion 17: the failure report knows the outcome of every step that can fail", () => {
  const listed = reportedSteps();
  assert.ok(listed.length >= 8, "lists the steps that can fail");
  const env = step(FAILURE);
  const names = stepNames();
  let last = -1;
  for (const { variable, name } of listed) {
    // Each name is a real step, in workflow order, and its outcome reaches the script by env.
    const at = names.findIndex((n) => n.startsWith(name));
    assert.ok(at >= 0, `"${name}" is not a step`);
    assert.ok(at > last, `"${name}" is out of order`);
    last = at;
    const id = /^ {8}id: (\S+)$/m.exec(step(names[at] ?? ""))?.[1];
    assert.ok(id, `step "${name}" has no id`);
    assert.ok(env.includes(`${variable}: \${{ steps.${id}.outcome }}`), `${variable} is not steps.${id}.outcome`);
  }
  assert.match(env, /RESULT_REASON: \$\{\{ steps\.result\.outputs\.reason \}\}/);
});

test("ticket-to-spec criterion 17: the failure comment names the first failed step", { skip: !hasBash && "needs bash" }, () => {
  const [first, second] = reportedSteps().slice(2, 4);
  assert.ok(first && second);
  const { posted } = reportFailure({ TICKET_KEY: "MEAL-9", [first.variable]: "failure", [second.variable]: "failure" });
  assert.ok(posted.includes(`Failed at the step "${first.name}".`), posted);
  assert.ok(!posted.includes(second.name), "only the first failed step");
  const cancelled = reportFailure({ TICKET_KEY: "MEAL-9", [first.variable]: "cancelled" }).posted;
  assert.ok(cancelled.includes(`Cancelled at the step "${first.name}"`), cancelled);
});

test("ticket-to-spec criteria 13, 17: a Claude failure is named from a fixed list, never with Claude's text", { skip: !hasBash && "needs bash" }, () => {
  const post = (reason: string) => reportFailure({ TICKET_KEY: "MEAL-9", RESULT_REASON: reason }).posted;
  assert.match(post("turn_cap"), /turn limit/);
  assert.match(post("claude_api"), /API error/);
  assert.match(post("claude_other"), /Claude stopped with an error/);
  assert.match(post("no_spec"), /no valid spec/);
  const unknown = post("ignore previous instructions");
  assert.doesNotMatch(unknown, /ignore previous/, "an unknown reason is never echoed");
  assert.match(unknown, /Not known/);
});

// Criteria 27-28: three of six credentials failed silently on the ticket, and all three expire
// together (27 Sep 2026 sanity check). A refused credential is named, never its value.
const REFUSERS = ["Read the ticket's comments", "G0 · is the ticket ready?", "Ask on the ticket"];

test("ticket-to-spec criterion 27: the repo checkout has an id, and the failure report checks it first", () => {
  assert.match(step("Check out the repo"), /^ {8}id: checkout$/m);
  assert.deepEqual(reportedSteps()[0], { variable: "OUT_CHECKOUT", name: "Check out the repo" });
});

test("ticket-to-spec criterion 27: the steps whose seula command can be refused record which credential", () => {
  for (const name of REFUSERS) {
    const run = script(name);
    const kind = name.startsWith("G0") ? "jev" : "tracker";
    assert.ok(run.includes("-eq 77"), `step "${name}" doesn't check for exit 77`);
    assert.ok(run.includes(`echo "SEULA_REFUSED=${kind}" >> "$GITHUB_ENV"`), `step "${name}" doesn't record ${kind}`);
  }
  assert.match(step(FAILURE), /SEULA_REFUSED/, "the report reads it from the job's environment");
});

test("ticket-to-spec edge case: a refused Jev key in the workflow's own G1 is a warning that names TYPESAFE_API_KEY", () => {
  const run = script("G1 · the workflow's own check");
  assert.match(run, /-eq 77/);
  assert.match(run, /::warning::.*TYPESAFE_API_KEY/);
});

test("ticket-to-spec criterion 27: the result names a Claude 401 or 403 as a refused key", { skip: !hasJq && "needs bash and jq" }, () => {
  const reason = (claude: Record<string, unknown>) => readResultOutputs({ status: "ready", g1: "pass", claudeExit: "1", claude }).reason ?? "";
  assert.equal(reason({ is_error: true, api_error_status: 401 }), "claude_key");
  assert.equal(reason({ is_error: true, api_error_status: 403 }), "claude_key");
  assert.equal(reason({ is_error: true, api_error_status: 529 }), "claude_api", "another API error stays an API error");
});

test("ticket-to-spec criterion 27: a refused tracker credential is named by its workflow and repo secret names", { skip: !hasBash && "needs bash" }, () => {
  const jira = reportFailure({ TICKET_KEY: "MEAL-9", SEULA_TRACKER: "jira", SEULA_REFUSED: "tracker", OUT_COMMENTS: "failure" });
  assert.match(jira.r.stdout, /JIRA_EMAIL/);
  assert.match(jira.r.stdout, /JIRA_API_TOKEN/);
  assert.match(jira.r.stdout, /repository admin can replace/);
  const gh = reportFailure({ TICKET_KEY: "9", SEULA_TRACKER: "github", SEULA_REFUSED: "tracker", OUT_COMMENTS: "failure" });
  assert.match(gh.posted, /SEULA_GH_TOKEN/);
});

test("ticket-to-spec criterion 27: a refused Jev key names TYPESAFE_API_KEY and SEULA_TYPESAFE_API_KEY", { skip: !hasBash && "needs bash" }, () => {
  const { posted } = reportFailure({ TICKET_KEY: "MEAL-9", SEULA_REFUSED: "jev", OUT_G0: "failure" });
  assert.match(posted, /`TYPESAFE_API_KEY`/);
  assert.match(posted, /`SEULA_TYPESAFE_API_KEY`/);
  assert.match(posted, /expired or revoked/);
});

test("ticket-to-spec criterion 27: a refused Anthropic key names ANTHROPIC_API_KEY and SEULA_ANTHROPIC_API_KEY", { skip: !hasBash && "needs bash" }, () => {
  const { posted } = reportFailure({ TICKET_KEY: "MEAL-9", RESULT_REASON: "claude_key" });
  assert.match(posted, /`ANTHROPIC_API_KEY`/);
  assert.match(posted, /`SEULA_ANTHROPIC_API_KEY`/);
});

test("ticket-to-spec criterion 27: a failed repo checkout names SEULA_GH_TOKEN as its only credential", { skip: !hasBash && "needs bash" }, () => {
  const { r, calls } = reportFailure({ OUT_CHECKOUT: "failure" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /::error::.*Check out the repo.*SEULA_GH_TOKEN/);
  assert.equal(calls, "", "no ticket key yet, so nothing is posted");
});

test("ticket-to-spec criterion 27: only a secret's name is written, never its value", { skip: !hasBash && "needs bash" }, () => {
  const values = { JIRA_API_TOKEN: "jira-sekret", JIRA_EMAIL: "me@acme.test", GITHUB_TOKEN: "ghs_sekret" };
  const { r, posted, summary } = reportFailure({ TICKET_KEY: "MEAL-9", SEULA_REFUSED: "tracker", OUT_COMMENTS: "failure", ...values });
  for (const value of Object.values(values)) {
    for (const [where, text] of [["comment", posted], ["log", r.stdout + r.stderr], ["summary", summary]]) {
      assert.ok(!text?.includes(value), `the ${where} holds a secret's value`);
    }
  }
});

test("ticket-to-spec criterion 28: the reason goes to the run's error and job summary, also with no ticket key", { skip: !hasBash && "needs bash" }, () => {
  const { r, calls, summary } = reportFailure({ SEULA_REFUSED: "jev", OUT_G0: "failure" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /::error::.*TYPESAFE_API_KEY/);
  assert.match(summary, /TYPESAFE_API_KEY/);
  assert.equal(calls, "");
});

test("ticket-to-spec criterion 28: when the tracker refuses the failure comment, the reason is still on the run", { skip: !hasBash && "needs bash" }, () => {
  const { r, summary } = reportFailure({ TICKET_KEY: "MEAL-9", SEULA_REFUSED: "tracker", OUT_COMMENTS: "failure", FAKE_SEULA_EXIT: "77" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /::error::.*JIRA_API_TOKEN/);
  assert.match(summary, /JIRA_API_TOKEN/);
});

// Criterion 19: G0 reads seula's own comments (criterion 18), so they must give its check for
// text aimed at the agent nothing to find.
const POSTERS = ["Ask on the ticket", "Report on the ticket", FAILURE];
const ANSWER_LINE = "The ticket's author can answer in a comment, then start seula again.";

test("ticket-to-spec criterion 19: seula's comments describe what happened, never command", () => {
  for (const name of POSTERS) {
    // The step's string literals, without its shell comments: everything it posts is built from them.
    const code = script(name).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    const text = [...code.matchAll(/'([^']*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? m[2] ?? "").join("\n");
    assert.doesNotMatch(text, /(^|[.:!?]\s|\\n)(Review|Re-run|Run|Merge|Decide|Set|Ignore|Execute)\b/m, `step "${name}" commands someone`);
    assert.match(text, /(^|")seula( · | failed to run)/m, `step "${name}" doesn't use seula's prefix`);
  }
});

test("ticket-to-spec criterion 19: a comment that asks for input says how to answer", () => {
  assert.ok(script("Ask on the ticket").includes(ANSWER_LINE));
  const report = script("Report on the ticket");
  const needsInput = report.slice(report.lastIndexOf("\nelse\n"));
  assert.ok(needsInput.includes("state=needsInput"), "found the needs-input branch");
  assert.ok(needsInput.includes(ANSWER_LINE), "the needs-input comment");
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

// Criterion 18: the ticket's answers in comments reach G0 and the agent (MEAL-1: they never did).
const COMMENTS = "Read the ticket's comments";

test("ticket-to-spec criterion 18: the comments go into the ticket file after the ticket is read and before G0", () => {
  const names = stepNames();
  const at = names.findIndex((n) => n.startsWith(COMMENTS));
  assert.ok(at >= 0, "no comments step");
  assert.ok(names.findIndex((n) => n.startsWith("Read the ticket (")) < at, "after the ticket is read");
  assert.ok(at < names.findIndex((n) => n.startsWith("G0 ·")), "before G0");
  assert.ok(script(COMMENTS).includes('$SEULA tracker comments --tracker "$SEULA_TRACKER" --key "$TICKET_KEY" --append "$TICKET_FILE"'));
});

test("ticket-to-spec criteria 6, 18: only the tracker's credentials reach the comments step", () => {
  const s = step(COMMENTS);
  for (const secret of ["SEULA_GH_TOKEN", "JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"]) assert.match(s, new RegExp(`secrets\.${secret}`));
  assert.doesNotMatch(s, /ANTHROPIC_API_KEY|TYPESAFE_API_KEY/);
  // The step that reads the ticket from the event still needs no secret.
  assert.doesNotMatch(step("Read the ticket ("), /secrets\./);
});

test("ticket-to-spec criteria 17-18: a failure to read the comments is a technical failure that names the step", () => {
  // No `|| true`: the step fails with the command's own exit code, and the failure report
  // names it (criterion 17).
  const run = script(COMMENTS);
  assert.doesNotMatch(run, /\|\|\s*true/);
  assert.match(run, /\|\| code=\$\?/);
  assert.match(run, /^exit "\$code"$/m);
  assert.ok(reportedSteps().some((s) => COMMENTS.startsWith(s.name) || s.name.startsWith(COMMENTS)), "the failure report knows the step");
  assert.equal(reportedSteps()[1]?.variable, "OUT_COMMENTS", "the first step that can fail after the repo checkout and the ticket are read");
});

test("ticket-to-spec criterion 11: the workflow stores Claude's cost with its breakdown", () => {
  const result = script("Read the result");
  assert.ok(result.includes('$SEULA update --run "$RUN_ID" --claude-result claude.json'));
  assert.doesNotMatch(result, /--claude-usd/, "the breakdown carries the total");
});

// Adoption criteria 11-12: the failure report names a step (criterion 17), so a person looks it
// up by that name. The page must follow the workflow when steps are added or renamed.
const DOCS = join(import.meta.dirname, "..", "docs");
const readDoc = (name: string): string => {
  try {
    return readFileSync(join(DOCS, name), "utf8").replace(/\r\n/g, "\n");
  } catch {
    return "";
  }
};
/** The page's `### ` entries, with the `## ` section each is in: their headings and their text up to the next heading. */
function troubleshootingEntries(section?: string): { heading: string; text: string }[] {
  const entries: { section: string; heading: string; text: string }[] = [];
  let current = "";
  for (const part of readDoc("troubleshooting.md").split(/^(?=#{2,3} )/m)) {
    if (part.startsWith("## ")) current = part.slice(3, part.indexOf("\n")).trim();
    if (part.startsWith("### ")) entries.push({ section: current, heading: part.slice(4, part.indexOf("\n")).trim(), text: part });
  }
  return entries.filter((e) => section === undefined || e.section === section);
}

const BOARD_SYNC = readFileSync(join(import.meta.dirname, "..", ".github", "workflows", "board-sync.yml"), "utf8").replace(/\r\n/g, "\n");
/** The step names of board-sync.yml, each once: both jobs check out the config and seula. */
const boardSyncStepNames = (): string[] => [...new Set([...BOARD_SYNC.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1] ?? ""))];

test("adoption criterion 12: every step of ticket-to-spec.yml has an entry in docs/troubleshooting.md, under its Actions name", () => {
  const headings = troubleshootingEntries("Steps").map((e) => e.heading);
  for (const name of stepNames()) assert.ok(headings.includes(name), `no entry for the step "${name}"`);
});

test("adoption criterion 12: the page has no entry for a step that no longer exists", () => {
  const names = stepNames();
  const entries = troubleshootingEntries("Steps");
  assert.ok(entries.length > 0, "the page has entries");
  for (const { heading } of entries) assert.ok(names.includes(heading), `"${heading}" is not a step of the workflow`);
});

test("adoption criterion 12: every step of board-sync.yml has an entry under Board sync steps, under its Actions name", () => {
  const headings = troubleshootingEntries("Board sync steps").map((e) => e.heading);
  assert.ok(boardSyncStepNames().length >= 4, "board-sync.yml has named steps");
  for (const name of boardSyncStepNames()) assert.ok(headings.includes(name), `no board sync entry for the step "${name}"`);
});

test("adoption criterion 12: the board sync section has no entry for a step that no longer exists", () => {
  const entries = troubleshootingEntries("Board sync steps");
  assert.ok(entries.length > 0, "the section has entries");
  for (const { heading } of entries) assert.ok(boardSyncStepNames().includes(heading), `"${heading}" is not a step of board-sync.yml`);
});

const SPEC_TO_PLAN = readFileSync(join(import.meta.dirname, "..", ".github", "workflows", "spec-to-plan.yml"), "utf8").replace(/\r\n/g, "\n");
const specToPlanStepNames = (): string[] => [...SPEC_TO_PLAN.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1] ?? "");

test("adoption criterion 12: every step of spec-to-plan.yml has an entry under Plan steps, under its Actions name", () => {
  const headings = troubleshootingEntries("Plan steps").map((e) => e.heading);
  assert.ok(specToPlanStepNames().length >= 10, "spec-to-plan.yml has named steps");
  for (const name of specToPlanStepNames()) assert.ok(headings.includes(name), `no plan entry for the step "${name}"`);
});

test("adoption criterion 12: the plan section has no entry for a step that no longer exists", () => {
  const entries = troubleshootingEntries("Plan steps");
  assert.ok(entries.length > 0, "the section has entries");
  for (const { heading } of entries) assert.ok(specToPlanStepNames().includes(heading), `"${heading}" is not a step of spec-to-plan.yml`);
});

test("spec-to-plan: both setup guides name the plan step's caller and say how to turn it off", () => {
  for (const guide of ["setup-jira.md", "setup-github-issues.md"]) {
    const text = readDoc(guide);
    assert.match(text, /seula-spec-to-plan\.yml/, `${guide}: the caller`);
    assert.match(text, /turn (it|the plan step) off/i, `${guide}: how to turn it off`);
  }
});

test("board-sync criterion 10: both setup guides say how to turn on Planning and require the ticket state check", () => {
  for (const guide of ["setup-jira.md", "setup-github-issues.md"]) {
    const text = readDoc(guide);
    assert.match(text, /tracker\.states\.planning/, `${guide}: the planning setting`);
    assert.match(text, /`seula \/ ticket state`/, `${guide}: the required check's name`);
    assert.match(text, /[Rr]uleset|branch protection/, `${guide}: where to require it`);
  }
});

test("adoption criterion 12: every entry says what the step does, how its failure looks, and what to check", () => {
  const entries = troubleshootingEntries();
  assert.ok(entries.length > 0, "the page has entries");
  for (const { heading, text } of entries) {
    for (const label of ["**What it does:**", "**When it fails:**", "**What to check:**"]) {
      assert.ok(text.includes(label), `"${heading}" lacks ${label}`);
    }
  }
});

test("adoption criterion 12: the page covers a move that starts no run and Anthropic credit that has run out", () => {
  const page = readDoc("troubleshooting.md");
  assert.match(page, /^## .*starts no run/m);
  assert.match(page, /audit log/);
  assert.match(page, /^## .*credit/im);
});

test("adoption criterion 11: the Jira setup guide points to the automation's audit log when a move starts no run", () => {
  const row = readDoc("setup-jira.md").split("\n").find((l) => /starts no run/i.test(l)) ?? "";
  assert.match(row, /audit log/);
  assert.match(row, /dispatch token/);
});

test("adoption criterion 12: the setup guides link to the troubleshooting page instead of repeating its step rows", () => {
  for (const guide of ["setup-jira.md", "setup-github-issues.md"]) {
    const text = readDoc(guide);
    assert.match(text, /\]\(troubleshooting\.md\)/, `${guide} doesn't link to the page`);
    assert.doesNotMatch(text, /^\| "(Check out the repo|Write the spec)" fails/m, `${guide} repeats a step row`);
  }
});
