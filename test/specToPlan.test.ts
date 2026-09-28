import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// specs/spec-to-plan-workflow.md, criteria 1-7: the plan workflow up to the workflow's own G2.
const WORKFLOWS = join(import.meta.dirname, "..", ".github", "workflows");
const read = (name: string) => readFileSync(join(WORKFLOWS, name), "utf8").replace(/\r\n/g, "\n");
const WORKFLOW = read("spec-to-plan.yml");
const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const hasBash = process.platform !== "win32" && spawnSync("bash", ["--version"]).status === 0;
const hasJq = hasBash && spawnSync("jq", ["--version"]).status === 0;

const FIND = "Find the ticket and the spec";
const APPROVE = "Keep the approved copy, then approve the spec";
const AGENT = "Write the plan";
const G2 = "G2 · the workflow's own check";

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
const stepIndex = (name: string) => stepNames().findIndex((n) => n.startsWith(name));

test("spec-to-plan criterion 1: a reusable workflow with the inputs and secrets of the spec", () => {
  assert.match(WORKFLOW, /^on:\n {2}workflow_call:\n/m);
  assert.match(WORKFLOW, /^ {6}tracker:\n(?: {8}.*\n)*? {8}required: true/m);
  assert.match(WORKFLOW, /^ {6}seula-ref:\n(?: {8}.*\n)*? {8}default: main/m);
  assert.match(WORKFLOW, /^ {6}model:\n(?: {8}.*\n)*? {8}default: opus/m);
  assert.match(WORKFLOW, /^ {6}base-branch:\n(?: {8}.*\n)*? {8}default: main/m);
  for (const secret of ["ANTHROPIC_API_KEY", "SEULA_GH_TOKEN"]) {
    assert.match(WORKFLOW, new RegExp(`^ {6}${secret}:\\n {8}required: true`, "m"), secret);
  }
  for (const secret of ["TYPESAFE_API_KEY", "JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"]) {
    assert.match(WORKFLOW, new RegExp(`^ {6}${secret}:\\n {8}required: false`, "m"), secret);
  }
});

test("spec-to-plan criterion 1: the job runs only for a merged pull request from a seula branch in the same repo", () => {
  const cond = (/^ {4}if: >-\n((?: {6}.*\n)+)/m.exec(WORKFLOW)?.[1] ?? "").replace(/\s+/g, " ");
  assert.match(cond, /github\.event\.pull_request\.merged == true/);
  assert.match(cond, /startsWith\(github\.event\.pull_request\.head\.ref, 'seula\/'\)/);
  assert.match(cond, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
});

test("spec-to-plan criterion 2: the repo at base-branch and seula at seula-ref, and no checkout stores a credential", () => {
  assert.match(step("Check out the repo"), /ref: \$\{\{ inputs\.base-branch \}\}/);
  assert.match(step("Check out the repo"), /persist-credentials: false/);
  assert.match(step("Check out seula"), /ref: \$\{\{ inputs\.seula-ref \}\}/);
  assert.match(step("Check out seula"), /persist-credentials: false/);
});

test("spec-to-plan criterion 2: the run id comes from tracker key; the branch and PR number arrive only as data", () => {
  assert.match(script(FIND), /\$SEULA tracker key --tracker "\$SEULA_TRACKER" --branch "\$HEAD_REF"/);
  assert.match(step(FIND), /HEAD_REF: \$\{\{ github\.event\.pull_request\.head\.ref \}\}/);
  assert.match(step(FIND), /PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/);
  for (const name of stepNames()) {
    if (!/run: \|/.test(step(name))) continue;
    assert.doesNotMatch(script(name), /\$\{\{/, `step "${name}"`);
  }
});

test("spec-to-plan criteria 4-5: the approved copy is made before seula approve, and never staged", () => {
  const s = script(APPROVE);
  const copy = s.indexOf('cp "$SPEC" "$APPROVED"');
  const approve = s.indexOf('$SEULA approve "$SPEC" --pr "$PR_NUMBER"');
  assert.ok(copy >= 0 && approve > copy, "copy first, then approve");
  assert.match(script(FIND), /APPROVED=\.seula\/approved\//);
  assert.ok(stepIndex(APPROVE) < stepIndex(AGENT), "approved before the agent runs");
  assert.doesNotMatch(WORKFLOW, /git add[^\n]*(-A|--all|\s\.(\s|$)|\.seula\/approved)/);
});

test("spec-to-plan criterion 6: the planner edits only the spec, runs only G2, and gets no key", () => {
  const agent = step(AGENT);
  const allowed = /--allowedTools "([^"]+)"/.exec(agent)?.[1]?.split(",") ?? [];
  assert.deepEqual(allowed, ["Skill", "Edit($SPEC)", "Bash($SEULA gate g2 *)"]);
  const denied = /--disallowedTools "([^"]+)"/.exec(agent)?.[1]?.split(",") ?? [];
  for (const t of ["WebFetch", "WebSearch", "Bash(git *)"]) assert.ok(denied.includes(t), `${t} not denied`);
  assert.match(agent, /blockReadsOutsideWorkingDirectories\\?"?:\s*true/);
  assert.match(agent, /--setting-sources user/);
  assert.match(agent, /CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1"/);
  for (const secret of ["SEULA_GH_TOKEN", "TYPESAFE_API_KEY", "JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"]) {
    assert.doesNotMatch(agent, new RegExp(secret), secret);
  }
  assert.match(script(AGENT), /\$SEULA prompt planner --run "\$RUN_ID" --spec "\$SPEC" --approved "\$APPROVED" --seula-cmd "\$SEULA"/);
});

test("spec-to-plan criterion 7: after the agent, G2 runs with the Jev key, --approved and --run", () => {
  assert.ok(stepIndex(G2) > stepIndex(AGENT));
  assert.match(step(G2), /TYPESAFE_API_KEY: \$\{\{ secrets\.TYPESAFE_API_KEY \}\}/);
  assert.match(script(G2), /\$SEULA gate g2 "\$SPEC" --approved "\$APPROVED" --run "\$RUN_ID"/);
  assert.match(script(G2), /::warning::Jev refused TYPESAFE_API_KEY/);
});

test("security criterion 2: Claude Code is pinned to the same version as in ticket-to-spec", () => {
  const version = (text: string) => /@anthropic-ai\/claude-code@(\d+\.\d+\.\d+)/.exec(text)?.[1];
  assert.ok(version(WORKFLOW), "an exact version");
  assert.equal(version(WORKFLOW), version(read("ticket-to-spec.yml")));
});

/** Runs the Find step with a stub `gh` that lists `files`, in a repo with the spec files that exist. */
function runFind(files: string[], existing: string[]) {
  const d = mkdtempSync(join(tmpdir(), "seula-plan-"));
  mkdirSync(join(d, "bin"));
  mkdirSync(join(d, "specs"));
  for (const f of existing) writeFileSync(join(d, f), "# FEATURE: x\n");
  writeFileSync(join(d, "seula.config.json"), JSON.stringify({ tracker: { type: "jira" }, ignore: ["specs/README.md"] }));
  writeFileSync(join(d, "bin", "gh"), `#!/usr/bin/env bash\nprintf '%s\\n' ${files.map((f) => `'${f}'`).join(" ")}\n`);
  chmodSync(join(d, "bin", "gh"), 0o755);
  const env = join(d, "github.env");
  writeFileSync(env, "");
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script(FIND)], {
    cwd: d,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(d, "bin")}:${process.env.PATH}`,
      SEULA: `node ${CLI}`,
      SEULA_TRACKER: "jira",
      HEAD_REF: "seula/meal-4",
      PR_NUMBER: "142",
      GITHUB_REPOSITORY: "acme/app",
      GITHUB_ENV: env,
    },
  });
  return { code: r.status, stdout: r.stdout, env: readFileSync(env, "utf8") };
}

test("spec-to-plan criterion 3: the one changed spec, leaving out the ignore list and other files", { skip: !hasJq && "needs bash and jq" }, () => {
  const r = runFind(["specs/README.md", "specs/page-description.md", "src/x.ts"], ["specs/README.md", "specs/page-description.md"]);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.env, /^RUN_ID=MEAL-4$/m);
  assert.match(r.env, /^SPEC=specs\/page-description\.md$/m);
  assert.match(r.env, /^APPROVED=\.seula\/approved\/page-description\.md$/m);
});

test("spec-to-plan criterion 3: no spec, or two, fails with the count", { skip: !hasJq && "needs bash and jq" }, () => {
  const none = runFind(["specs/README.md", "src/x.ts"], ["specs/README.md"]);
  assert.notEqual(none.code, 0);
  assert.match(none.stdout, /::error::.*changed 0 specs/);
  const two = runFind(["specs/a.md", "specs/b.md"], ["specs/a.md", "specs/b.md"]);
  assert.notEqual(two.code, 0);
  assert.match(two.stdout, /::error::.*changed 2 specs/);
});

test("spec-to-plan criterion 3: every script runs in bash with pipefail, so a failed command in a pipe fails the step", () => {
  assert.match(WORKFLOW, /^defaults:\n {2}run:\n {4}shell: bash$/m);
});

test("spec-to-plan criterion 3: a failed file list call fails the step, not as 0 specs", { skip: !hasJq && "needs bash and jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "seula-plan-"));
  mkdirSync(join(d, "bin"));
  writeFileSync(join(d, "bin", "gh"), "#!/usr/bin/env bash\necho 'HTTP 401: Bad credentials' >&2\nexit 1\n");
  chmodSync(join(d, "bin", "gh"), 0o755);
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script(FIND)], {
    cwd: d,
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(d, "bin")}:${process.env.PATH}`, SEULA: `node ${CLI}`, SEULA_TRACKER: "jira", HEAD_REF: "seula/meal-4", PR_NUMBER: "142", GITHUB_REPOSITORY: "acme/app", GITHUB_ENV: join(d, "env") },
  });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /changed 0 specs/);
});
