import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// The seula-gates skill (specs/agent-plugin.md criterion 15): what an agent does around G2.
const SKILL = readFileSync(join(import.meta.dirname, "..", "skills", "seula-gates", "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
/** The skill's `## ` section whose heading starts with `name`. */
const section = (name: string): string => {
  const at = SKILL.indexOf(`\n## ${name}`);
  assert.ok(at >= 0, `no section "${name}"`);
  const end = SKILL.indexOf("\n## ", at + 1);
  return SKILL.slice(at, end < 0 ? undefined : end);
};

test("agent-plugin criterion 15: the gate table runs G2 after a plan, and only G3 to G5 are missing", () => {
  const table = section("Which gate to run");
  assert.match(table, /\| write or change a plan \| `seula gate g2 <spec file> --approved <approved spec file> --run <id>` \|/);
  assert.doesNotMatch(SKILL, /G2 to G5 are not available/);
  assert.match(SKILL, /G3 to G5 are not available/);
});

test("agent-plugin criterion 15: one fix for each G2 rule", () => {
  const fixes = section("How to fix G2 feedback");
  for (const rule of ["task", "coverage", "path", "approved"]) {
    assert.match(fixes, new RegExp(`^\| \`${rule}\` \|`, "m"), rule);
  }
});

test("agent-plugin criterion 15: a G2 flag is for the plan reviewer, and hiding it is forbidden", () => {
  const fixes = section("How to fix G2 feedback");
  assert.match(fixes, /flag/i);
  assert.match(fixes, /person who reviews the plan/);
  assert.match(fixes, /Do not change the plan only to avoid a flag\./);
});
