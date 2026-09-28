import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const WORKFLOW = readFileSync(join(import.meta.dirname, "..", ".github", "workflows", "board-sync.yml"), "utf8").replace(/\r\n/g, "\n");
const hasBash = process.platform !== "win32" && spawnSync("bash", ["--version"]).status === 0;
const hasJq = hasBash && spawnSync("jq", ["--version"]).status === 0;

const CHECK = "ticket state";
const MOVE = "move on merge";

/** The text of the job whose `name:` is `name`, from its id line to the next job. */
function job(name: string): string {
  const lines = WORKFLOW.split("\n");
  const at = lines.findIndex((l) => l === `    name: ${name}`);
  assert.ok(at > 0, `job "${name}" not found`);
  let start = at;
  while (start > 0 && !/^ {2}\S/.test(lines[start] ?? "")) start--;
  let end = at + 1;
  while (end < lines.length && !/^ {2}\S|^\S/.test(lines[end] ?? "")) end++;
  return lines.slice(start, end).join("\n");
}

/** The `if:` condition of a job, on one line. */
function condition(name: string): string {
  const m = /^ {4}if: >-\n((?: {6}.*\n)+)/m.exec(`${job(name)}\n`);
  assert.ok(m, `job "${name}" has no if`);
  return (m[1] ?? "").replace(/\s+/g, " ").trim();
}

/** The `run: |` scripts of a job's steps, dedented. */
function scripts(name: string): string[] {
  return [...job(name).matchAll(/^ {8}run: \|\n((?: {10}.*\n?|\n)+)/gm)].map((m) => (m[1] ?? "").replace(/^ {10}/gm, ""));
}

/** Runs a job's last script with bash, `$SEULA` replaced by a stub that prints `stdout` and exits `code`. */
function runScript(name: string, stub: { stdout: string; code: number }) {
  const d = mkdtempSync(join(tmpdir(), "seula-board-"));
  writeFileSync(join(d, "stub.sh"), `cat <<'OUT'\n${stub.stdout}\nOUT\nexit ${stub.code}\n`);
  const summary = join(d, "summary.md");
  writeFileSync(summary, "");
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", scripts(name).at(-1) ?? ""], {
    cwd: d,
    env: { ...process.env, SEULA: `bash ${join(d, "stub.sh")}`, SEULA_TRACKER: "jira", HEAD_REF: "seula/meal-4", GITHUB_STEP_SUMMARY: summary },
    encoding: "utf8",
  });
  return { code: r.status, stdout: r.stdout, summary: readFileSync(summary, "utf8") };
}

test("board-sync criterion 1: a reusable workflow with the tracker, the seula ref and optional Jira secrets", () => {
  assert.match(WORKFLOW, /^on:\n {2}workflow_call:\n/m);
  assert.match(WORKFLOW, /^ {6}tracker:\n(?: {8}.*\n)*? {8}required: true/m);
  assert.match(WORKFLOW, /^ {6}seula-ref:\n(?: {8}.*\n)*? {8}default: main/m);
  for (const secret of ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"]) {
    assert.match(WORKFLOW, new RegExp(`^ {6}${secret}:\\n {8}required: false`, "m"), secret);
  }
});

test("board-sync criterion 1: two jobs, ticket state and move on merge", () => {
  const names = [...WORKFLOW.matchAll(/^ {4}name: (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(names, [CHECK, MOVE]);
});

test("board-sync criterion 1: both jobs run only for a seula branch in the same repo, never a fork", () => {
  for (const name of [CHECK, MOVE]) {
    const cond = condition(name);
    assert.match(cond, /startsWith\(github\.event\.pull_request\.head\.ref, 'seula\/'\)/, name);
    assert.match(cond, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/, name);
  }
});

test("board-sync criteria 3, 5: ticket state runs on every event but closed; move on merge only on a merge", () => {
  assert.match(condition(CHECK), /github\.event\.action != 'closed'/);
  assert.match(condition(MOVE), /github\.event\.action == 'closed'/);
  assert.match(condition(MOVE), /github\.event\.pull_request\.merged == true/);
});

test("board-sync criterion 2: the branch name reaches the scripts only through the environment", () => {
  for (const name of [CHECK, MOVE]) {
    assert.match(job(name), /HEAD_REF: \$\{\{ github\.event\.pull_request\.head\.ref \}\}/, name);
    for (const s of scripts(name)) assert.doesNotMatch(s, /\$\{\{/, name);
    assert.match(scripts(name).join("\n"), /--branch "\$HEAD_REF"/, name);
  }
});

test("board-sync criterion 4: ticket state fails on needsInput and says to answer the questions first", () => {
  const s = scripts(CHECK).join("\n");
  assert.match(s, /\$SEULA tracker state --tracker "\$SEULA_TRACKER" --branch "\$HEAD_REF" --fail-on needsInput/);
  assert.match(s, /Answer the questions on the ticket first/);
  assert.match(s, /GITHUB_STEP_SUMMARY/);
});

test("board-sync criteria 5-6: move on merge moves to planning and writes the result to the job summary", () => {
  const s = scripts(MOVE).join("\n");
  assert.match(s, /\$SEULA tracker move --tracker "\$SEULA_TRACKER" --branch "\$HEAD_REF" --state planning/);
  assert.match(s, /GITHUB_STEP_SUMMARY/);
});

test("board-sync criterion 7: the config comes from the base branch, and no checkout stores a credential", () => {
  for (const name of [CHECK, MOVE]) {
    const j = job(name);
    assert.match(j, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/, name);
    assert.match(j, /sparse-checkout: seula\.config\.json/, name);
    assert.doesNotMatch(j, /pull_request\.head\.sha/, name);
    const checkouts = j.match(/uses: actions\/checkout@/g)?.length ?? 0;
    const noCredential = j.match(/persist-credentials: false/g)?.length ?? 0;
    assert.ok(checkouts >= 2 && noCredential === checkouts, `${name}: ${noCredential} of ${checkouts} checkouts`);
  }
});

test("board-sync criterion 8: only the tracker's credentials, and no permissions beyond the caller's", () => {
  const used = [...new Set([...WORKFLOW.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(used, ["JIRA_API_TOKEN", "JIRA_BASE_URL", "JIRA_EMAIL"]);
  for (const other of ["ANTHROPIC_API_KEY", "TYPESAFE_API_KEY", "SEULA_GH_TOKEN"]) assert.doesNotMatch(WORKFLOW, new RegExp(other));
  assert.match(WORKFLOW, /GITHUB_TOKEN: \$\{\{ inputs\.tracker == 'github' && github\.token \|\| '' \}\}/);
  assert.doesNotMatch(WORKFLOW, /^permissions:/m);
});

test("board-sync criterion 9: seula's exit code is never hidden", () => {
  assert.match(WORKFLOW, /^defaults:\n {2}run:\n {4}shell: bash$/m);
  for (const s of [...scripts(CHECK), ...scripts(MOVE)]) {
    for (const line of s.split("\n").filter((l) => l.includes("$SEULA"))) assert.doesNotMatch(line, /\|\| true/, line);
  }
});

test("board-sync criterion 4: needs input fails the check with the key in the message", { skip: !hasJq && "needs bash and jq" }, () => {
  const r = runScript(CHECK, { stdout: '{"key":"MEAL-4","status":"Needs input","state":"needsInput"}', code: 1 });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /::error::MEAL-4 needs input\. Answer the questions on the ticket first/);
  assert.match(r.summary, /MEAL-4 needs input/);
});

test("board-sync criterion 4: any other state passes the check", { skip: !hasJq && "needs bash and jq" }, () => {
  const r = runScript(CHECK, { stdout: '{"key":"MEAL-4","status":"Spec review","state":"specReview"}', code: 0 });
  assert.equal(r.code, 0);
  assert.match(r.summary, /MEAL-4 doesn't need input/);
});

test("board-sync criterion 9: a failed tracker call fails the check with seula's exit code", { skip: !hasJq && "needs bash and jq" }, () => {
  const r = runScript(CHECK, { stdout: "", code: 77 });
  assert.equal(r.code, 77);
  assert.match(r.summary, /exited 77/);
});

test("board-sync criteria 6, 9: move on merge reports an unset planning state, and passes seula's exit code on", { skip: !hasBash && "needs bash" }, () => {
  const skipped = runScript(MOVE, { stdout: "Moved nothing: tracker.states.planning is not set in seula.config.json.", code: 0 });
  assert.equal(skipped.code, 0);
  assert.match(skipped.summary, /tracker\.states\.planning is not set/);
  assert.equal(runScript(MOVE, { stdout: "", code: 70 }).code, 70);
});
