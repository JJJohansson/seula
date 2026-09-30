import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { approveSpec } from "../src/approve.ts";
import { checkPlan } from "../src/gates/checkPlan.ts";
import { jevPlan } from "../src/gates/jevPlan.ts";
import { parseSpec } from "../src/spec.ts";
import { FakeModel, config, fixture } from "./helpers.ts";

// G2 and seula approve for a spec that already existed (specs/g2-plan-gate.md criteria 1-6 with
// --base; specs/spec-to-plan-workflow.md criterion 15). BASE is the spec before the merge: three
// criteria and a plan with two tasks. The merge added criterion 4.

const BASE = fixture("plan-spec.md").replace(/\r\n/g, "\n");
const C4 = "4. The description is in the page's language.";
const T3 = "3. Set the description's language. Criteria: 4. Test: client/index.test.ts \"criterion 4: the language\". Files: client/index.html.";
/** The spec after the merge, with criterion 4, and these lines at the end of `## PLAN`. */
const merged = (...planLines: string[]): string =>
  `${BASE.replace("3. The description says what the app does.", `3. The description says what the app does.\n${C4}`).trimEnd()}\n${planLines.join("\n")}\n`;
const WITH_T3 = merged(T3);

const errors = (md: string, base?: string, approved?: string) => checkPlan(md, config(), approved, base).findings.map((f) => `${f.rule}: ${f.message}`);

// ── plan rules (criteria 1-4) ───────────────────────────────────────────────

test("g2 criteria 2-3: with a base version, a new task that covers the new criterion passes", () => {
  assert.deepEqual(errors(WITH_T3, BASE), []);
});

test("g2 criterion 2: an old task without labels is not checked", () => {
  const oldFreeText = BASE.replace(/1\. Add the description meta tag[\s\S]*$/, "1. Build it in the page's head, then test it.\n");
  const now = `${oldFreeText.replace("3. The description says what the app does.", `3. The description says what the app does.\n${C4}`).trimEnd()}\n${T3.replace("Criteria: 4.", "Criteria: 1-4.")}\n`;
  assert.deepEqual(errors(now, oldFreeText), []);
});

test("g2 criterion 2: an edited old task and a new task each need all three labels", () => {
  const edited = merged(T3).replace("Files: client/index.html.\n2.", "\n2.");
  assert.ok(errors(edited, BASE).some((e) => /^task: Plan task 1 has no Files:/.test(e)), "task 1 was edited, so it is checked");
  const noTest = merged(T3.replace(/ Test: .*? Files:/, " Files:"));
  assert.ok(errors(noTest, BASE).some((e) => /^task: Plan task 3 has no Test:/.test(e)));
});

test("g2 criterion 3: a changed criterion must be covered by a changed task; an old task doesn't count", () => {
  // Criterion 3's text changes. Old task 2 names criterion 3, but it planned the old text.
  const reworded = WITH_T3.replace("3. The description says what the app does.", "3. The description says what the app does, in one sentence.");
  assert.ok(errors(reworded, BASE).includes("coverage: No plan task covers criterion 3."));
  assert.deepEqual(errors(reworded, undefined).filter((e) => e.startsWith("coverage")), [], "without a base version, old task 2 counts");
  // Editing task 2 makes it a changed task, and then it covers criterion 3:
  const editedTask = reworded.replace("Write the sentence.", "Write the one sentence.");
  assert.deepEqual(errors(editedTask, BASE), []);
  // Unchanged criteria need no new task:
  assert.ok(!errors(merged(T3), BASE).some((e) => e.startsWith("coverage")));
});

test("g2 criterion 3: a changed task can name an unchanged criterion, but not one the spec doesn't have", () => {
  assert.deepEqual(errors(merged(T3.replace("Criteria: 4.", "Criteria: 1, 4.")), BASE), []);
  assert.ok(errors(merged(T3.replace("Criteria: 4.", "Criteria: 4, 9.")), BASE).some((e) => /names criterion 9/.test(e)));
});

test("g2 criterion 4: a bad path in an old task is not checked; in a changed task it is an error", () => {
  const oldBad = BASE.replace("Files: client/index.html, client/src/strings.ts.", "Files: ../outside.ts.");
  assert.deepEqual(errors(merged(T3).replace("Files: client/index.html, client/src/strings.ts.", "Files: ../outside.ts."), oldBad), []);
  assert.ok(errors(merged(T3.replace("Files: client/index.html.", "Files: /abs.ts.")), BASE).some((e) => e.startsWith("path:")));
});

test("g2 criterion 1: with a base version, a plan with no changed task is an error", () => {
  const onlyEdge = BASE.replace("- A browser that ignores the description: nothing breaks.", "- A browser that ignores the description: nothing breaks.\n- A very long title: the description stays short.");
  assert.ok(errors(onlyEdge, BASE).some((e) => /^plan: /.test(e)), "no criterion changed, and no task either");
  const withTask = `${onlyEdge.trimEnd()}\n3. Test a long title. Criteria: 1. Test: client/index.test.ts "long title". Files: client/index.test.ts.\n`;
  assert.deepEqual(errors(withTask, BASE), [], "one new task is enough when no criterion changed");
});

test("g2 edge cases: without a base version everything is checked, as before", () => {
  assert.ok(errors(merged(), undefined).includes("coverage: No plan task covers criterion 4."));
  assert.deepEqual(errors(WITH_T3, undefined), []);
});

test("g2 edge cases: renumbered tasks with the same text are unchanged", () => {
  const swapped = merged().replace(/1\. Add the description meta tag/, "9. Add the description meta tag").replace(/\n2\. Write the sentence/, "\n1. Write the sentence").replace(/\n9\. Add/, "\n2. Add");
  assert.ok(errors(swapped, BASE).some((e) => /^plan: /.test(e)), "only renumbered: still no changed task");
});

test("g2 edge cases: a base version without ## PLAN makes every task changed", () => {
  const noPlan = BASE.slice(0, BASE.indexOf("## PLAN"));
  assert.deepEqual(errors(WITH_T3, noPlan), []);
  assert.ok(errors(WITH_T3.replace("Files: client/index.html.\n2.", "\n2."), noPlan).some((e) => /Plan task 1 has no Files:/.test(e)));
});

// ── Jev flags (criterion 6) ─────────────────────────────────────────────────

test("g2 criterion 6: with a base version, Jev sees only the changed criteria and the changed tasks", async () => {
  const model = new FakeModel(() => 0.05);
  const spec = parseSpec(WITH_T3, config());
  const check = checkPlan(WITH_T3, config(), undefined, BASE);
  await jevPlan(spec, config(), model, check.change);
  const state = model.calls[0]?.state as { criteria: string; plan: string };
  assert.equal(state.criteria, C4);
  assert.equal(state.plan, T3);
});

test("g2 criterion 6: an old sign-in task doesn't flag the new plan", async () => {
  const signInOld = BASE.replace("Write the sentence.", "Change the sign-in page.");
  const now = WITH_T3.replace("Write the sentence.", "Change the sign-in page.");
  const model = new FakeModel(() => 0.05);
  const flagSignIn = { ...model, evaluate: async (req: Parameters<FakeModel["evaluate"]>[0]) => {
    const plan = String((req.state as { plan?: string }).plan);
    return { answers: { signIn: plan.includes("sign-in") ? 0.95 : 0.05, storedData: 0.05, personalData: 0.05 }, inputTokens: 10, model: "fake" };
  } };
  const withBase = await jevPlan(parseSpec(now, config()), config(), flagSignIn, checkPlan(now, config(), undefined, signInOld).change);
  assert.deepEqual(withBase.flags, []);
  const whole = await jevPlan(parseSpec(now, config()), config(), flagSignIn);
  assert.deepEqual(whole.flags.map((f) => f.question), ["signIn"], "without a base version, the whole plan is asked about");
});

// ── the approved copy (criterion 5) ─────────────────────────────────────────

test("g2 criterion 5: the whole status block may differ from the approved copy, the text after it may not", () => {
  const approvedCopy = WITH_T3.replace(/^> \*\*Status:\*\*.*$/m, "> **Status: Idea.** Drafted from ticket\n> [MEAL-4](https://example.test/MEAL-4).");
  const afterApprove = WITH_T3.replace(/^> \*\*Status:\*\*.*$/m, "> **Status:** Approved (30 Sep 2026, merged in #9). Drafted from ticket\n> [MEAL-4](https://example.test/MEAL-4).\n> Change approved (30 Sep 2026, merged in #9).");
  assert.deepEqual(errors(afterApprove, BASE, approvedCopy), []);
  const changedOverview = afterApprove.replace("The page has a short description", "The page has a long description");
  assert.ok(errors(changedOverview, BASE, approvedCopy).some((e) => e.startsWith("approved:")));
});

// ── the command ─────────────────────────────────────────────────────────────

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const run = (args: string[], cwd: string) => {
  const env = { ...process.env };
  for (const key of ["TYPESAFE_API_KEY", "JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "GITHUB_TOKEN"]) delete env[key];
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const repo = (now: string, base?: string): string => {
  const root = mkdtempSync(join(tmpdir(), "seula-g2base-"));
  mkdirSync(join(root, "specs"));
  mkdirSync(join(root, ".seula", "base", "specs"), { recursive: true });
  writeFileSync(join(root, "specs", "x.md"), now);
  if (base !== undefined) writeFileSync(join(root, ".seula", "base", "specs", "x.md"), base);
  return root;
};

test("g2 inputs: gate g2 --base reads the base version from the base folder", () => {
  // An old free-text plan: without --base its tasks fail the rules; with --base only task 3 counts.
  const oldPlan = BASE.replace(/1\. Add the description meta tag[\s\S]*$/, "1. Build it in the page's head, then test it.\n");
  const now = `${oldPlan.replace("3. The description says what the app does.", `3. The description says what the app does.\n${C4}`).trimEnd()}\n${T3}\n`;
  const root = repo(now, oldPlan);
  const withBase = run(["gate", "g2", "specs/x.md", "--base", ".seula/base"], root);
  assert.equal(withBase.code, 0, withBase.out);
  const without = run(["gate", "g2", "specs/x.md"], root);
  assert.equal(without.code, 1, without.out);
  assert.match(without.out, /Plan task 1 has no/);
});

test("g2 edge cases: gate g2 with a missing --base folder, or a spec outside the repo, exits 64", () => {
  const root = repo(WITH_T3, BASE);
  assert.equal(run(["gate", "g2", "specs/x.md", "--base", ".seula/bse"], root).code, 64);
  writeFileSync(join(root, "outside.md"), WITH_T3);
  assert.equal(run(["gate", "g2", "../outside.md", "--base", ".seula/base"], join(root, "specs")).code, 64);
});

// ── seula approve (spec-to-plan criterion 15) ───────────────────────────────

const TODAY = new Date(Date.UTC(2026, 8, 30));
const withStatus = (block: string) => BASE.replace(/^> \*\*Status:\*\*.*$/m, block);
const statusBlock = (md: string) => md.split("\n").filter((l) => l.startsWith(">"));

test("spec-to-plan criterion 15: an Idea spec gets Approved in place of the status marker", () => {
  assert.deepEqual(statusBlock(approveSpec(withStatus("> **Status:** Idea"), config(), 142, TODAY)), ["> **Status:** Approved (30 Sep 2026, merged in #142)."]);
});

test("spec-to-plan criterion 15: a status block over two lines keeps the rest of the block", () => {
  const block = "> **Status: Idea.** Drafted from ticket\n> [MEAL-4](https://example.test/MEAL-4) by seula.";
  assert.deepEqual(statusBlock(approveSpec(withStatus(block), config(), 146, TODAY)), [
    "> **Status:** Approved (30 Sep 2026, merged in #146). Drafted from ticket",
    "> [MEAL-4](https://example.test/MEAL-4) by seula.",
  ]);
});

test("spec-to-plan criterion 15: a (…) right after the old status is dropped", () => {
  const out = approveSpec(withStatus("> **Status:** Idea (27 Sep 2026). Split from change B."), config(), 7, TODAY);
  assert.deepEqual(statusBlock(out), ["> **Status:** Approved (30 Sep 2026, merged in #7). Split from change B."]);
});

test("spec-to-plan criterion 15: a buildable status stays, and a line goes at the end of the block's first paragraph", () => {
  const block = "> **Status: Active (v1 shipped).** Criteria confirmed; v1 covers\n> the active week only.\n>\n> Builds on the weekly plan.";
  assert.deepEqual(statusBlock(approveSpec(withStatus(block), config(), 146, TODAY)), [
    "> **Status: Active (v1 shipped).** Criteria confirmed; v1 covers",
    "> the active week only.",
    "> Change approved (30 Sep 2026, merged in #146).",
    ">",
    "> Builds on the weekly plan.",
  ]);
});

test("spec-to-plan criterion 15: a one-line buildable status gets the line directly under it", () => {
  const out = approveSpec(withStatus("> **Status:** Approved (28 Sep 2026). Built 28 Sep 2026."), config(), 30, TODAY);
  assert.deepEqual(statusBlock(out), ["> **Status:** Approved (28 Sep 2026). Built 28 Sep 2026.", "> Change approved (30 Sep 2026, merged in #30)."]);
});

test("spec-to-plan criterion 15: nothing outside the status block changes, and CRLF stays CRLF", () => {
  const idea = withStatus("> **Status:** Idea");
  const out = approveSpec(idea, config(), 142, TODAY);
  assert.equal(out.replace("> **Status:** Approved (30 Sep 2026, merged in #142).", "> **Status:** Idea"), idea);
  const crlf = approveSpec(withStatus("> **Status: Active.** Built.").replace(/\n/g, "\r\n"), config(), 3, TODAY);
  assert.ok(crlf.includes("> **Status: Active.** Built.\r\n> Change approved (30 Sep 2026, merged in #3).\r\n"));
  assert.doesNotMatch(crlf.replace(/\r\n/g, ""), /\n/, "every line ends in CRLF");
});
