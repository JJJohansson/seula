import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { UsageError } from "../src/errors.ts";
import { parseSpec } from "../src/spec.ts";
import { changedCriteria, changedTasks, readBaseVersion, unchangedLine } from "../src/specDiff.ts";
import { config } from "./helpers.ts";

/** A small spec with these criteria, and a `## PLAN` with these tasks when given. */
const spec = (criteria: string[], plan?: string[]): string =>
  [
    "# FEATURE: Export",
    "",
    "> **Status:** Idea",
    "",
    "## OVERVIEW",
    "Export the list.",
    "",
    "## ACCEPTANCE CRITERIA",
    ...criteria,
    "",
    "## OUT OF SCOPE",
    "- Import.",
    "",
    "## EDGE CASES",
    "- An empty list.",
    ...(plan ? ["", "## PLAN", ...plan] : []),
    "",
  ].join("\n");

const parsed = (markdown: string) => parseSpec(markdown, config());
const changed = (now: string[], base?: string[]) => [...changedCriteria(parsed(spec(now)), base && parsed(spec(base)))];

const BASE = ["1. The button downloads a CSV file.", "2. The file has a header row.", "3. Each item is one row."];

test("g1 data schema: a criterion with a number that the base version doesn't have is changed", () => {
  assert.deepEqual(changed([...BASE, "4. The file name has the date."], BASE), ["4"]);
});

test("g1 data schema: different text is changed; the same text with other spacing or wrapping is not", () => {
  const now = [
    "1. The button downloads a CSV   file.",
    "2. The file has a header",
    "   row.",
    "3. Each item is one row, in the list's order.",
  ];
  assert.deepEqual(changed(now, BASE), ["3"]);
});

test("g1 data schema: without a base version, every criterion is changed", () => {
  assert.deepEqual(changed(BASE), ["1", "2", "3"]);
});

test("g1 data schema: an inserted number such as 6b is changed when the base version doesn't have it", () => {
  assert.deepEqual(changed(["1. The button downloads a CSV file.", "1b. The button shows a spinner.", ...BASE.slice(1)], BASE), ["1b"]);
});

test("g1 edge cases: renumbered criteria are changed, a removed one is not listed, and a base without criteria changes all", () => {
  assert.deepEqual(changed(["1. The file has a header row.", "2. Each item is one row."], BASE), ["1", "2"]);
  assert.deepEqual(changed(BASE.slice(0, 2), BASE), []);
  const noCriteria = spec([]).replace("## ACCEPTANCE CRITERIA\n", "");
  assert.deepEqual([...changedCriteria(parsed(spec(BASE)), parsed(noCriteria))], ["1", "2", "3"]);
});

test("g1 edge cases: a base version with Windows line endings gives the same result", () => {
  const crlf = parsed(spec(BASE).replace(/\n/g, "\r\n"));
  assert.deepEqual([...changedCriteria(parsed(spec([...BASE, "4. The file name has the date."])), crlf)], ["4"]);
});

test("g1 criterion 20: a line that is in the base version is unchanged, also with other spacing; an edited line is not", () => {
  const base = spec(BASE).replace("## OUT OF SCOPE\n- Import.", "## OUT OF SCOPE\n- Import. TBD which formats.");
  const inBase = unchangedLine(base);
  assert.equal(inBase("- Import.   TBD which formats."), true);
  assert.equal(inBase("- Import. TBD which formats, and when."), false);
  assert.equal(inBase(""), false, "a blank line is never a finding, so it isn't reported as unchanged");
  assert.equal(unchangedLine(undefined)("- Import. TBD which formats."), false, "without a base version, no line is unchanged");
});

const TASKS = ["1. Add the button. Criteria: 1. Test: export.test.ts. Files: src/export.ts.", "2. Add the header. Criteria: 2. Test: export.test.ts. Files: src/export.ts."];
const tasks = (now: string[], base?: string[]) => [...changedTasks(spec(BASE, now), base && spec(BASE, base), config())];

test("g2 data schema: a task whose text is in the base plan is unchanged, also when its number changed", () => {
  assert.deepEqual(tasks(["1. Add the header. Criteria: 2. Test: export.test.ts. Files: src/export.ts.", TASKS[0]!.replace(/^1\./, "2.")], TASKS), []);
});

test("g2 data schema: a new task and an edited task are changed", () => {
  const now = [TASKS[0]!, "2. Add the header, bold. Criteria: 2. Test: export.test.ts. Files: src/export.ts.", "3. One row per item. Criteria: 3. Test: export.test.ts. Files: src/export.ts."];
  assert.deepEqual(tasks(now, TASKS), ["2", "3"]);
});

test("g2 data schema: without a base version, or with a base without ## PLAN, every task is changed", () => {
  assert.deepEqual(tasks(TASKS), ["1", "2"]);
  assert.deepEqual([...changedTasks(spec(BASE, TASKS), spec(BASE), config())], ["1", "2"]);
});

test("g2 criterion 2: an old free-text plan item without labels that is unchanged stays unchanged", () => {
  const old = ["1. Build the export first, then the tests."];
  assert.deepEqual(tasks([...old, "2. Add the date. Criteria: 4. Test: export.test.ts. Files: src/export.ts."], old), ["2"]);
});

/** A repo folder with a base folder inside it. */
const repo = () => {
  const root = mkdtempSync(join(tmpdir(), "seula-base-"));
  mkdirSync(join(root, ".seula", "base", "specs"), { recursive: true });
  return root;
};

test("g1 data schema: the base version is read at the spec's path from the repo root, inside the base folder", () => {
  const root = repo();
  writeFileSync(join(root, ".seula", "base", "specs", "x.md"), "base text\n");
  assert.equal(readBaseVersion(join(root, ".seula", "base"), join(root, "specs", "x.md"), root), "base text\n");
  assert.equal(readBaseVersion(".seula/base", "specs/x.md", root), "base text\n", "relative paths are read from the repo root");
});

test("g1 data schema: a spec with no file in the base folder is a new spec", () => {
  assert.equal(readBaseVersion(".seula/base", "specs/new.md", repo()), undefined);
});

test("g1 edge cases: with --base, a spec outside the repo root is a usage error", () => {
  const root = repo();
  assert.throws(() => readBaseVersion(".seula/base", "../other/x.md", root), (err: unknown) => err instanceof UsageError && /inside the repo/.test(err.message));
});
