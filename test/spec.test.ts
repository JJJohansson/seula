import assert from "node:assert/strict";
import { test } from "node:test";
import { headingMatches, parseSpec } from "../src/spec.ts";
import { config, parse } from "./helpers.ts";

test("g1 criteria 1-4: parses title, status, sections and criteria", () => {
  const spec = parse("good-spec.md");
  assert.equal(spec.title, "FEATURE: Export shopping list as CSV");
  assert.equal(spec.status, "Approved");
  assert.equal(spec.statusLine, 3);
  assert.deepEqual(
    spec.sections.map((s) => s.normalized),
    ["OVERVIEW", "WHY / INTENT", "INPUTS / OUTPUTS", "ACCEPTANCE CRITERIA", "OUT OF SCOPE", "EDGE CASES"],
  );
  assert.equal(spec.criteria.length, 5);
});

test("joins a criterion's continuation lines", () => {
  const c2 = parse("good-spec.md").criteria[1];
  assert.equal(c2?.number, "2");
  assert.match(c2?.text ?? "", /Monday of the active week in `YYYY-MM-DD` form\.$/);
});

test("g1 criterion 2: reads both status styles and picks the first status word", () => {
  const cfg = config();
  const a = parseSpec("# X\n\n> **Status: Idea (drafted, not scheduled).** Not Active yet.\n", cfg);
  assert.equal(a.status, "Idea");
  const b = parseSpec("# X\n\n> **Status:** Approved / scheduled\n", cfg);
  assert.equal(b.status, "Approved");
  const c = parseSpec("# X\n\n> **Status:** Parked\n", cfg);
  assert.equal(c.status, undefined);
  assert.equal(c.statusText, "Parked");
});

test("g1 criterion 3: heading qualifiers don't block a match", () => {
  assert.ok(headingMatches("OUT OF SCOPE (v1)", "OUT OF SCOPE"));
  assert.ok(headingMatches("EDGE CASES / RISKS", "EDGE CASES"));
  assert.ok(headingMatches("Acceptance criteria (DRAFT)", "ACCEPTANCE CRITERIA"));
  assert.ok(!headingMatches("OVERVIEW", "OUT OF SCOPE"));
});

test("allows lettered inserts and sub-headings inside the criteria", () => {
  const md = [
    "# X",
    "## ACCEPTANCE CRITERIA",
    "### Listing",
    "1. The list shows every saved recipe.",
    "   It is sorted by name.",
    "### Editing",
    "2. Editing a recipe saves on submit.",
    "2b. Unsaved changes prompt before leaving.",
    "",
    "A note that is not part of criterion 2b.",
  ].join("\n");
  const spec = parseSpec(md, config());
  assert.deepEqual(
    spec.criteria.map((c) => [c.number, c.text]),
    [
      ["1", "The list shows every saved recipe. It is sorted by name."],
      ["2", "Editing a recipe saves on submit."],
      ["2b", "Unsaved changes prompt before leaving."],
    ],
  );
});

test("g1 criterion 6: ignores numbered lines inside code fences", () => {
  const md = "# X\n## ACCEPTANCE CRITERIA\n1. Real criterion here.\n```\n2. not a criterion\n```\n";
  assert.equal(parseSpec(md, config()).criteria.length, 1);
});
