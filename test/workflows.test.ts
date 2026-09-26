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
