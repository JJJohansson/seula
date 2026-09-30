import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkSpec } from "../src/gates/checkSpec.ts";
import { criterionRequest, jevSpec, specContext } from "../src/gates/jevSpec.ts";
import { RecordingModel } from "../src/jev/model.ts";
import { parseSpec } from "../src/spec.ts";
import { FakeModel, config } from "./helpers.ts";

// G1 with --base: only the ticket's change to a spec that already exists (specs/g1-spec-gate.md
// criteria 18-20 and the edge cases). The base version below has an old TBD, an old template slot
// and an old criterion that is too short, like a real spec that was approved before these rules.

const OLD_TBD = "- Checked state: TBD (see DECISIONS).";
const OLD_SLOT = "- Format: <one of the formats>.";
const CRITERIA = ["1. The button downloads a CSV file.", "2. The file has a header row.", "3. Rows sorted."];

/** A spec with these criteria. `parts` replaces a section's lines, or removes it with null. */
const spec = (criteria: string[] = CRITERIA, parts: Record<string, string[] | null> = {}): string => {
  const sections: [string, string[]][] = [
    ["OVERVIEW", ["Export the list."]],
    ["DATA SCHEMA", [OLD_TBD, OLD_SLOT]],
    ["ACCEPTANCE CRITERIA", criteria],
    ["OUT OF SCOPE", ["- Import."]],
    ["EDGE CASES", ["- An empty list."]],
    ["DECISIONS", ["- Client only."]],
  ];
  const body = sections
    .map(([title, lines]): [string, string[] | null] => [title, title in parts ? (parts[title] ?? null) : lines])
    .filter((s): s is [string, string[]] => s[1] !== null)
    .map(([title, lines]) => `## ${title}\n${lines.join("\n")}\n`);
  return ["# FEATURE: Export", "", "> **Status:** Active", "", ...body].join("\n");
};

const BASE = spec();
const WITH_4 = spec([...CRITERIA, "4. The file name contains the date."]);
const parsed = (md: string) => parseSpec(md, config());
const findings = (md: string, base?: string) => checkSpec(parsed(md), config(), { base }).findings.map((f) => `${f.severity}:${f.rule}:${f.message}`);

// ── format rules (criterion 20, criterion 18) ───────────────────────────────

test("g1 criterion 20: an old TBD is a warning that says it was already there, and the spec passes", () => {
  const r = checkSpec(parsed(WITH_4), config(), { base: BASE });
  assert.equal(r.ok, true);
  const tbd = r.findings.find((f) => f.message.includes("TBD"));
  assert.equal(tbd?.severity, "warn");
  assert.match(tbd?.message ?? "", /already in the base version/);
});

test("g1 criterion 20: a TBD in a new or edited line is still an error", () => {
  const edited = spec([...CRITERIA, "4. The file name contains the date."], { "DATA SCHEMA": ["- Checked state: TBD (see DECISIONS), per week.", OLD_SLOT] });
  assert.ok(findings(edited, BASE).some((f) => f.startsWith("error:placeholder:") && f.includes("per week")));
  const added = spec([...CRITERIA, "4. The file name contains the date."], { "EDGE CASES": ["- An empty list.", "- A very long list: TBD."] });
  assert.ok(findings(added, BASE).some((f) => f.startsWith("error:placeholder:") && f.includes("very long list")));
});

test("g1 criterion 20: an old template slot is also only a warning", () => {
  const slot = checkSpec(parsed(WITH_4), config(), { base: BASE }).findings.find((f) => f.message.includes("<one of the formats>"));
  assert.equal(slot?.severity, "warn");
  assert.match(slot?.message ?? "", /already in the base version/);
});

test("g1 criterion 20: a too-short unchanged criterion is not reported; a too-short changed one is an error", () => {
  assert.ok(!findings(WITH_4, BASE).some((f) => f.includes(":criterion-text:")));
  const short = spec([...CRITERIA, "4. Date shown."]);
  assert.deepEqual(
    findings(short, BASE).filter((f) => f.includes(":criterion-text:")),
    ["error:criterion-text:Criterion 4 is too short to test."],
  );
});

test("g1 criterion 20: the other format rules still cover the whole file", () => {
  const broken = spec(["1. The button downloads a CSV file.", "1. The file has a header row."], { "OUT OF SCOPE": null });
  const found = findings(broken, broken);
  assert.ok(found.some((f) => f.startsWith("error:numbering:")), "a duplicate number, even an old one");
  assert.ok(found.some((f) => f.startsWith("error:section:")), "a missing section, even an old gap");
});

test("g1 criterion 18: without a base version (a new spec), the findings are the same as without --base", () => {
  assert.deepEqual(findings(WITH_4, undefined), checkSpec(parsed(WITH_4), config()).findings.map((f) => `${f.severity}:${f.rule}:${f.message}`));
  assert.ok(findings(WITH_4, undefined).some((f) => f.startsWith("error:placeholder:")));
});

test("g1 edge cases: an old line moved to another section with the same words keeps its warning", () => {
  const moved = spec([...CRITERIA, "4. The file name contains the date."], { "DATA SCHEMA": [OLD_SLOT], DECISIONS: ["- Client only.", OLD_TBD] });
  const tbd = checkSpec(parsed(moved), config(), { base: BASE }).findings.find((f) => f.message.includes("TBD"));
  assert.equal(tbd?.severity, "warn");
});

test("g1 edge cases: a base version with Windows line endings still makes an old TBD a warning", () => {
  const tbd = checkSpec(parsed(WITH_4), config(), { base: BASE.replace(/\n/g, "\r\n") }).findings.find((f) => f.message.includes("TBD"));
  assert.equal(tbd?.severity, "warn");
});

// ── Jev (criterion 19) ──────────────────────────────────────────────────────

const criteriaAsked = (model: FakeModel) => model.calls.map((c) => String((c.state as { criterion?: string }).criterion).split(".")[0]);

test("g1 criterion 19: with a base version, Jev gets a request only for each changed criterion", async () => {
  const model = new FakeModel(() => 0.95);
  const r = await jevSpec(parsed(WITH_4), config(), model, { base: parsed(BASE) });
  assert.deepEqual(criteriaAsked(model), ["4"]);
  assert.deepEqual(r.criteria.map((c) => c.number), ["4"]);
  assert.equal(r.unchanged, 3);
  assert.equal(r.decision, "pass");
});

test("g1 criterion 19: when no criterion changed, Jev is not called and the Jev half passes", async () => {
  const model = new FakeModel(() => 0.95);
  const r = await jevSpec(parsed(BASE), config(), model, { base: parsed(BASE) });
  assert.equal(model.calls.length, 0);
  assert.equal(r.decision, "pass");
  assert.deepEqual(r.criteria, []);
  assert.equal(r.unchanged, 3);
});

test("g1 criterion 19: an unchanged criterion that Jev would send back doesn't change the result", async () => {
  const model = new FakeModel((criterion) => (criterion.startsWith("2.") ? 0.05 : 0.95));
  assert.equal((await jevSpec(parsed(WITH_4), config(), model, { base: parsed(BASE) })).decision, "pass");
  assert.equal((await jevSpec(parsed(WITH_4), config(), new FakeModel((criterion) => (criterion.startsWith("2.") ? 0.05 : 0.95)))).decision, "back", "without a base version, criterion 2 sends it back");
});

test("g1 edge cases: renumbered criteria are all checked, and a removed criterion is not", async () => {
  const renumbered = new FakeModel(() => 0.95);
  await jevSpec(parsed(spec(["1. The file has a header row.", "2. Rows sorted by name, A to Z."])), config(), renumbered, { base: parsed(BASE) });
  assert.deepEqual(criteriaAsked(renumbered), ["1", "2"]);
  const removed = new FakeModel(() => 0.95);
  const r = await jevSpec(parsed(spec(CRITERIA.slice(0, 2))), config(), removed, { base: parsed(BASE) });
  assert.equal(removed.calls.length, 0, "a ticket that only removes a criterion has nothing to ask");
  assert.equal(r.decision, "pass");
});

test("g1 edge cases: a base version without a criteria section makes every criterion changed", async () => {
  const model = new FakeModel(() => 0.95);
  await jevSpec(parsed(WITH_4), config(), model, { base: parsed(spec(CRITERIA, { "ACCEPTANCE CRITERIA": null })) });
  assert.deepEqual(criteriaAsked(model), ["1", "2", "3", "4"]);
});

test("g1 out of scope: a changed overview doesn't check the unchanged criteria again", async () => {
  const model = new FakeModel(() => 0.95);
  const r = await jevSpec(parsed(spec(CRITERIA, { OVERVIEW: ["Export the list, and share it."] })), config(), model, { base: parsed(BASE) });
  assert.equal(model.calls.length, 0);
  assert.equal(r.decision, "pass");
});

// ── the commands (criteria 18-19, edge cases) ────────────────────────────────

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");

function run(args: string[], cwd: string) {
  const env = { ...process.env };
  for (const key of ["TYPESAFE_API_KEY", "JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "GITHUB_TOKEN"]) delete env[key];
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** A repo with the spec at specs/x.md and its base version at .seula/base/specs/x.md (when given). */
function repo(now: string, base?: string): string {
  const root = mkdtempSync(join(tmpdir(), "seula-g1base-"));
  mkdirSync(join(root, "specs"));
  mkdirSync(join(root, ".seula", "base", "specs"), { recursive: true });
  writeFileSync(join(root, "specs", "x.md"), now);
  if (base !== undefined) writeFileSync(join(root, ".seula", "base", "specs", "x.md"), base);
  return root;
}

/** Records Fake answers for exactly these criteria of `md`, so a replay fails on any other request. */
async function recordOnly(root: string, md: string, numbers: string[]): Promise<string> {
  const file = join(root, "rec.json");
  const s = parsed(md);
  const model = new RecordingModel(new FakeModel(() => 0.95), file);
  for (const c of s.criteria.filter((c) => numbers.includes(c.number))) await model.evaluate(criterionRequest(specContext(s), c, config()));
  return file;
}

test("g1 criterion 18: check-spec --base passes a spec whose only TBD is old; without --base it goes back", () => {
  const root = repo(WITH_4, BASE);
  const withBase = run(["check-spec", "specs/x.md", "--base", ".seula/base"], root);
  assert.equal(withBase.code, 0, withBase.out);
  assert.match(withBase.out, /already in the base version/);
  assert.equal(run(["check-spec", "specs/x.md"], root).code, 1);
});

test("g1 criterion 18: check-spec --base reads each spec's own base version", () => {
  const root = repo(WITH_4, BASE);
  writeFileSync(join(root, "specs", "new.md"), WITH_4);
  const r = run(["check-spec", "specs/x.md", "specs/new.md", "--base", ".seula/base"], root);
  assert.equal(r.code, 1, "new.md has no base version, so its TBD is an error");
  assert.match(r.out, /1 of 2 specs pass/);
});

test("g1 criteria 18-19: gate g1 --base asks Jev only about the changed criteria, and says how many it skipped", async () => {
  const root = repo(WITH_4, BASE);
  const rec = await recordOnly(root, WITH_4, ["4"]);
  const r = run(["gate", "g1", "specs/x.md", "--base", ".seula/base", "--recorded", rec], root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /criterion 4 /);
  assert.doesNotMatch(r.out, /criterion 1 /);
  assert.match(r.out, /3 unchanged criteria not checked \(--base\)/);
});

test("g1 criterion 19: gate g1 --base with no changed criterion says so and never calls Jev", () => {
  const root = repo(BASE, BASE);
  const r = run(["gate", "g1", "specs/x.md", "--base", ".seula/base", "--recorded", join(root, "none.json")], root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no criteria changed/);
});

test("g1 criterion 18: jev-spec takes --base like gate g1", async () => {
  const root = repo(WITH_4, BASE);
  const rec = await recordOnly(root, WITH_4, ["4"]);
  const r = run(["jev-spec", "specs/x.md", "--base", ".seula/base", "--recorded", rec], root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /3 unchanged criteria not checked \(--base\)/);
});

test("g1 criterion 18: with --base but no base version, gate g1 checks every criterion and prints no skip line", async () => {
  const root = repo(spec([...CRITERIA.slice(0, 2), "3. Rows are sorted by name.", "4. The file name contains the date."], { "DATA SCHEMA": ["- Checked state: client only."] }));
  const md = spec([...CRITERIA.slice(0, 2), "3. Rows are sorted by name.", "4. The file name contains the date."], { "DATA SCHEMA": ["- Checked state: client only."] });
  const rec = await recordOnly(root, md, ["1", "2", "3", "4"]);
  const r = run(["gate", "g1", "specs/x.md", "--base", ".seula/base", "--recorded", rec], root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /criterion 1 /);
  assert.doesNotMatch(r.out, /not checked/);
});

test("g1 edge cases: every criterion deleted is still a format error, and Jev isn't called", () => {
  const root = repo(spec([]), BASE);
  const r = run(["gate", "g1", "specs/x.md", "--base", ".seula/base", "--recorded", join(root, "none.json")], root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no numbered criteria/);
});

test("g1 edge cases: --base with a spec outside the repo exits 64", () => {
  const root = repo(WITH_4, BASE);
  writeFileSync(join(root, "outside.md"), WITH_4);
  // Run from specs/ as the repo root, so ../outside.md is a real file outside it.
  const r = run(["check-spec", "../outside.md", "--base", ".seula/base"], join(root, "specs"));
  assert.equal(r.code, 64, r.out);
  assert.match(r.out, /inside the repo/);
});

test("g1 edge cases: a --base folder that doesn't exist exits 64 and names the folder", () => {
  const root = repo(WITH_4, BASE);
  const r = run(["gate", "g1", "specs/x.md", "--base", ".seula/bse"], root);
  assert.equal(r.code, 64, r.out);
  assert.match(r.out, /\.seula\/bse/);
});
