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

// Unit 6, criteria 8-14: the result, the secret check, the plan pull request, the reports.
const RESULT = "Read the result";
const SECRETS = "Check the agent's output for secrets";
const PR = "Commit and open the plan pull request";
const REPORT = "Report on the ticket";
const FAILURE = "Report a failure on the ticket";

/** Runs a step's script with bash in a fresh directory holding `files`; returns its outputs. */
function runStep(name: string, env: Record<string, string>, files: Record<string, string> = {}) {
  const d = mkdtempSync(join(tmpdir(), "seula-plan-"));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(d, f, ".."), { recursive: true });
    writeFileSync(join(d, f), text);
  }
  const out = join(d, "github.output");
  const summary = join(d, "summary.md");
  writeFileSync(out, "");
  writeFileSync(summary, "");
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script(name)], {
    cwd: d,
    encoding: "utf8",
    env: { ...process.env, SEULA: `node ${CLI}`, SEULA_TRACKER: "jira", GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, ...env },
  });
  const lines = readFileSync(out, "utf8").split("\n").filter(Boolean);
  const outputs = Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, outputs, summary: readFileSync(summary, "utf8") };
}

test("spec-to-plan criterion 8: the secret check runs before the commit, the pull request and the report", () => {
  const at = stepIndex(SECRETS);
  assert.ok(at > stepIndex(G2) && at < stepIndex(PR) && at < stepIndex(REPORT));
  const s = script(SECRETS);
  for (const f of ['"$SPEC"', '"$RUN_FILE"', "claude.json"]) assert.ok(s.includes(f), f);
});

test("spec-to-plan criterion 9: the commit stages only the spec and the run file, on a seula-plan/ branch, with the token only in its git commands", () => {
  const s = script(PR);
  const adds = [...s.matchAll(/^\s*git add (.+)$/gm)].map((m) => m[1]);
  assert.ok(adds.length > 0);
  for (const add of adds) assert.equal(add, '"$SPEC" "$RUN_FILE"');
  assert.ok(s.includes(`branch="seula-plan/$(printf '%s' "$RUN_ID" | tr '[:upper:]' '[:lower:]')"`));
  assert.ok(s.includes('git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $auth"'));
  assert.doesNotMatch(s, /git config [^\n]*extraheader/);
  assert.ok(s.includes('gh pr view "$branch"'));
  assert.ok(s.includes('gh pr create --base "$BASE_BRANCH" --head "$branch"'));
});

test("spec-to-plan criterion 9: the pull request links the ticket and the spec pull request, and lists G2's results and the cost", () => {
  const s = script(PR);
  assert.ok(s.includes("#$PR_NUMBER"));
  assert.ok(s.includes(".links.ticket"));
  assert.ok(s.includes('select(.gate == "G2")'));
  assert.ok(s.includes("Cost: Claude"));
  assert.ok(s.includes("Needs your judgement"));
});

test("spec-to-plan criterion 11: the comment starts with seula · , and the workflow never moves the ticket", () => {
  assert.ok(script(REPORT).includes("seula · "));
  assert.ok(script(REPORT).includes('$SEULA tracker comment --tracker "$SEULA_TRACKER" --key "$TICKET_KEY"'));
  assert.doesNotMatch(WORKFLOW, /tracker move/);
});

function reportedSteps(): { variable: string; name: string }[] {
  return [...script(FAILURE).matchAll(/^ {2}"(OUT_[A-Z0-9_]+)\|([^"]+)"$/gm)].map((m) => ({ variable: m[1] ?? "", name: m[2] ?? "" }));
}

test("spec-to-plan criterion 12: the failure report runs on failure, knows every step that can fail, and posts no agent output", () => {
  const failure = step(FAILURE);
  assert.ok(failure.includes("if: failure() || cancelled() || steps.result.outputs.status == 'failed'"));
  const listed = reportedSteps();
  const names = stepNames();
  let last = -1;
  for (const { variable, name } of listed) {
    const at = names.findIndex((n) => n.startsWith(name));
    assert.ok(at > last, `"${name}" is missing or out of order`);
    last = at;
    const id = /^ {8}id: (\S+)$/m.exec(step(names[at] ?? ""))?.[1];
    assert.ok(id && failure.includes(`${variable}: \${{ steps.${id}.outcome }}`), `${name}: ${variable}`);
  }
  const withIds = names.filter((n) => /^ {8}id: /m.test(step(n)) && !n.startsWith(FAILURE));
  for (const n of withIds) assert.ok(listed.some((l) => n.startsWith(l.name)), `"${n}" can fail but isn't listed`);
  assert.doesNotMatch(script(FAILURE), /claude\.json/);
});

test("spec-to-plan criterion 13: the Claude cost goes into the run file with its breakdown", () => {
  assert.ok(script(RESULT).includes('$SEULA update --run "$RUN_ID" --claude-result claude.json'));
});

test("spec-to-plan criterion 14: ticket-to-spec never takes a seula-plan/ branch as a spec branch", () => {
  const reuse = /\[\[ "\$existing" =~ (\S+) \]\]/.exec(read("ticket-to-spec.yml"))?.[1] ?? "";
  assert.ok(reuse, "ticket-to-spec checks the branch it reuses");
  assert.ok(!new RegExp(reuse).test("seula-plan/meal-4"));
  assert.ok(new RegExp(reuse).test("seula/meal-4"));
});

const planRun = (g2: { result: string; feedback?: string[] }[], blocked = false) =>
  JSON.stringify({ id: "MEAL-4", blocked, events: g2.map((e) => ({ gate: "G2", ...e })), cost: { claudeUsd: 0, jevUsd: 0 }, links: {} });
const claudeOut = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    is_error: false,
    subtype: "success",
    structured_output: { spec_path: "specs/page-description.md", status: "ready", questions: [], summary: "Plan." },
    ...over,
  });
const RESULT_ENV = { RUN_ID: "MEAL-4", RUN_FILE: ".seula/runs/MEAL-4.json", SPEC: "specs/page-description.md", CLAUDE_EXIT: "0", HAS_JEV: "true" };
const resultOf = (run: string, claude: string, env: Record<string, string> = {}) =>
  runStep(RESULT, { ...RESULT_ENV, ...env }, {
    ".seula/runs/MEAL-4.json": run,
    "claude.json": claude,
    "specs/page-description.md": "# FEATURE: x\n",
  }).outputs;

test("spec-to-plan criterion 10: ready, review and draft follow the last G2 result and the agent's questions", { skip: !hasJq && "needs bash and jq" }, () => {
  const asked = { structured_output: { spec_path: "specs/page-description.md", status: "needs_input", questions: ["Which page?"], summary: "" } };
  assert.equal(resultOf(planRun([{ result: "back" }, { result: "pass" }]), claudeOut()).status, "ready");
  assert.equal(resultOf(planRun([{ result: "review", feedback: ["plan · signIn: 0.80 → flag"] }]), claudeOut()).status, "review");
  assert.equal(resultOf(planRun([{ result: "back" }]), claudeOut()).status, "draft");
  assert.equal(resultOf(planRun([{ result: "pass" }]), claudeOut(asked)).status, "draft");
  assert.equal(resultOf(planRun([{ result: "back" }], true), claudeOut()).status, "blocked");
  assert.equal(resultOf(planRun([{ result: "skipped" }]), claudeOut()).status, "draft", "skipped with a Jev key configured");
  assert.equal(resultOf(planRun([{ result: "skipped" }]), claudeOut(), { HAS_JEV: "false" }).status, "ready", "skipped, no Jev key");
});

test("spec-to-plan criteria 10, 12: a Claude error or another spec path is a failure with a fixed reason", { skip: !hasJq && "needs bash and jq" }, () => {
  const run = planRun([{ result: "pass" }]);
  const other = resultOf(run, claudeOut({ structured_output: { spec_path: "specs/other.md", status: "ready", questions: [], summary: "" } }));
  assert.deepEqual([other.status, other.reason], ["failed", "no_spec"]);
  const capped = resultOf(run, claudeOut({ is_error: true, subtype: "error_max_turns" }), { CLAUDE_EXIT: "1" });
  assert.deepEqual([capped.status, capped.reason], ["failed", "turn_cap"]);
});

test("spec-to-plan criterion 8: a planted key fails the check and names it, but never prints its value", { skip: !hasBash && "needs bash" }, () => {
  const r = runStep(SECRETS, { SPEC: "specs/x.md", RUN_FILE: ".seula/runs/MEAL-4.json", ANTHROPIC_API_KEY: "sk-ant-planted-4242" }, {
    "specs/x.md": "# FEATURE: x\n\nsk-ant-planted-4242\n",
    ".seula/runs/MEAL-4.json": "{}",
  });
  assert.notEqual(r.code, 0);
  assert.match(r.stdout, /ANTHROPIC_API_KEY/);
  assert.ok(!`${r.stdout}${r.stderr}`.includes("sk-ant-planted-4242"));
});

test("spec-to-plan criterion 12: a refused file list call names SEULA_GH_TOKEN; with no ticket key nothing is posted", { skip: !hasBash && "needs bash" }, () => {
  const r = runStep(FAILURE, { OUT_FIND: "failure", SEULA_REFUSED: "gh", TICKET_KEY: "" });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /::error::seula failed to run\. Failed at the step "Find the ticket and the spec"\..*SEULA_GH_TOKEN/);
  assert.match(r.summary, /SEULA_GH_TOKEN/);
  assert.match(r.stdout, /::warning::No ticket key/);
});
