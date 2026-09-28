import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPlan } from "../src/gates/checkPlan.ts";
import { config, fixture } from "./helpers.ts";

const SPEC = fixture("plan-spec.md").replace(/\r\n/g, "\n");
const PLAN_AT = SPEC.indexOf("## PLAN");
/** The fixture spec with its `## PLAN` section replaced by `plan` (or removed when undefined). */
const withPlan = (plan?: string): string => (plan === undefined ? SPEC.slice(0, PLAN_AT) : `${SPEC.slice(0, PLAN_AT)}## PLAN\n${plan}\n`);
const errors = (markdown: string, approved?: string) =>
  checkPlan(markdown, config(), approved).findings.filter((f) => f.severity === "error");
const rules = (markdown: string, approved?: string) => errors(markdown, approved).map((f) => f.rule);

test("g2 criteria 1-4: the fixture's plan passes the rules", () => {
  const r = checkPlan(SPEC, config());
  assert.deepEqual(r.findings, []);
  assert.equal(r.ok, true);
});

test("g2 criterion 1: a spec without ## PLAN, or a plan without a numbered task, is an error", () => {
  assert.deepEqual(rules(withPlan()), ["plan"]);
  assert.deepEqual(rules(withPlan("Only an introduction, and no tasks.")), ["plan"]);
});

test("g2 criterion 2: each missing Criteria, Test or Files is one error that names the task", () => {
  const found = errors(withPlan("1. Do a thing. Criteria: 1, 2, 3. Files: a.ts.\n2. Another. Test: t.ts. Files: b.ts.\n3. Third. Criteria: 1. Test: t.ts."));
  assert.deepEqual(
    found.map((f) => [f.rule, f.message.match(/task \d+/)?.[0]]),
    [
      ["task", "task 1"],
      ["task", "task 2"],
      ["task", "task 3"],
    ],
  );
  assert.match(found[0]?.message ?? "", /Test:/);
  assert.match(found[1]?.message ?? "", /Criteria:/);
  assert.match(found[2]?.message ?? "", /Files:/);
});

test("g2 criterion 3: an uncovered criterion and an unknown criterion number are errors", () => {
  const uncovered = errors(withPlan("1. Tag. Criteria: 1, 2. Test: t.ts. Files: a.html."));
  assert.deepEqual(uncovered.map((f) => f.rule), ["coverage"]);
  assert.match(uncovered[0]?.message ?? "", /criterion 3/);
  const unknown = errors(withPlan("1. Tag. Criteria: 1, 2, 3, 9. Test: t.ts. Files: a.html."));
  assert.deepEqual(unknown.map((f) => f.rule), ["coverage"]);
  assert.match(unknown[0]?.message ?? "", /9/);
});

test("g2 edge case: a range names every number in it; a range that runs backwards is an error", () => {
  assert.deepEqual(rules(withPlan("1. All. Criteria: 1-3. Test: t.ts. Files: a.html.")), []);
  assert.deepEqual(rules(withPlan("1. All. Criteria: 1–3. Test: t.ts. Files: a.html.")), []);
  assert.deepEqual(rules(withPlan("1. All. Criteria: 1, 3-2. Test: t.ts. Files: a.html.")).includes("task"), true);
});

test("g2 criterion 4: an absolute path or a path with .. is an error", () => {
  for (const path of ["/etc/passwd", "C:\\x\\y.ts", "../outside.ts", "client/../../x.ts"]) {
    const found = errors(withPlan(`1. All. Criteria: 1-3. Test: t.ts. Files: client/index.html, ${path}.`));
    assert.deepEqual(found.map((f) => f.rule), ["path"], path);
    assert.ok(found[0]?.message.includes(path), path);
  }
});

test("g2 criterion 5: with --approved, only ## PLAN and the status line may differ", () => {
  const approved = SPEC.slice(0, PLAN_AT).replace("> **Status:** Approved (28 Sep 2026, merged in #142)", "> **Status:** Idea");
  assert.deepEqual(rules(SPEC, approved), []);
  const changed = SPEC.replace("3. The description says what the app does.", "3. The description says what the app does, in English.");
  const found = errors(changed, approved);
  assert.deepEqual(found.map((f) => f.rule), ["approved"]);
  assert.match(found[0]?.message ?? "", /ACCEPTANCE CRITERIA/);
  const retitled = SPEC.replace("# FEATURE: Page description", "# FEATURE: Page text");
  assert.deepEqual(rules(retitled, approved), ["approved"]);
});

test("g2 edge cases: wrapped tasks, intro text and ### headings, a criterion named twice, CRLF", () => {
  const plan = "Intro text.\n\n### Tasks\n1. Tag.\n   Criteria: 1, 2.\n   Test: t.ts.\n   Files: a.html.\n2. Words. Criteria: 2, 3. Test: t.ts. Files: b.ts.";
  assert.deepEqual(rules(withPlan(plan)), []);
  assert.deepEqual(rules(SPEC.replace(/\n/g, "\r\n")), []);
});
