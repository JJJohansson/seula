import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSpec } from "../src/gates/checkSpec.ts";
import { parseSpec } from "../src/spec.ts";
import { config, parse } from "./helpers.ts";

test("g1 criterion 9: a complete spec passes", () => {
  const r = checkSpec(parse("good-spec.md"), config());
  assert.equal(r.ok, true);
  assert.deepEqual(r.findings, []);
});

test("g1 criteria 3-7: a rushed spec is sent back with every problem listed", () => {
  const r = checkSpec(parse("bad-spec.md"), config());
  assert.equal(r.ok, false);
  const rules = r.findings.map((f) => `${f.severity}:${f.rule}`);
  assert.ok(rules.includes("error:section"), "missing OUT OF SCOPE");
  assert.ok(rules.includes("error:draft"), "DRAFT criteria with a buildable status");
  assert.ok(rules.includes("warn:numbering"), "there is no criterion 2");
  assert.ok(rules.includes("error:criterion-text"), "'Nice.' is too short");
  const placeholders = r.findings.filter((f) => f.rule === "placeholder");
  assert.equal(placeholders.length, 2, "template slot + TBD, but not the TODO inside the code block");
});

test("g1 criterion 8: an Idea spec passes format checks with an info note", () => {
  const md = parseSpec(
    "# FEATURE: X\n\n> **Status:** Idea\n\n## OVERVIEW\nA thing.\n\n## ACCEPTANCE CRITERIA\n1. The thing shows a label.\n\n## OUT OF SCOPE\n- More.\n\n## EDGE CASES\n- None.\n",
    config(),
  );
  const r = checkSpec(md, config());
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.findings.map((f) => [f.severity, f.rule]),
    [["info", "status"]],
  );
});

test("g1 criterion 6: placeholders in inline code and JSX-like tags are not flagged", () => {
  const md = parseSpec(
    "# FEATURE: X\n\n> **Status:** Approved\n\n## OVERVIEW\nUses the `TODO` marker and a <Button> primitive.\n\n## ACCEPTANCE CRITERIA\n1. The button renders its label.\n\n## OUT OF SCOPE\n- More.\n\n## EDGE CASES\n- None.\n",
    config(),
  );
  assert.equal(checkSpec(md, config()).ok, true);
});

test("g1 criterion 5: criteria may be grouped out of order, but a number can't repeat", () => {
  const head = "# FEATURE: X\n\n> **Status:** Approved\n\n## OVERVIEW\nA thing.\n\n## OUT OF SCOPE\n- More.\n\n## EDGE CASES\n- None.\n\n## ACCEPTANCE CRITERIA\n";
  const reordered = checkSpec(parseSpec(`${head}1. First thing shows up.\n3. Third thing shows up.\n2. Second thing shows up.\n`, config()), config());
  assert.deepEqual(reordered.findings, []);
  const dup = checkSpec(parseSpec(`${head}1. First thing shows up.\n2. Second thing shows up.\n2. Another second thing.\n`, config()), config());
  assert.equal(dup.ok, false);
  assert.match(dup.findings[0]?.message ?? "", /numbered twice/);
});

test("g1 criterion 2: an unknown status is an error", () => {
  const md = parseSpec("# X\n> **Status:** Parked\n", config());
  const r = checkSpec(md, config());
  assert.ok(r.findings.some((f) => f.rule === "status" && f.severity === "error"));
});
