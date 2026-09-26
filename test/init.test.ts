import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { init, seulaVersion } from "../src/init.ts";

function repo(opts: { git?: boolean; dirs?: string[]; files?: Record<string, string> } = {}): string {
  const d = mkdtempSync(join(tmpdir(), "seula-init-"));
  if (opts.git !== false) mkdirSync(join(d, ".git"));
  for (const dir of opts.dirs ?? []) mkdirSync(join(d, dir), { recursive: true });
  for (const [f, c] of Object.entries(opts.files ?? {})) writeFileSync(join(d, f), c);
  return d;
}
const read = (d: string, f: string) => readFileSync(join(d, f), "utf8");

test("adoption criteria 1-5: a fresh repo gets a config, two caller workflows and a template", () => {
  const d = repo();
  const r = init({ cwd: d, tracker: "github" });
  assert.deepEqual(
    r.files.map((f) => [f.path, f.action]),
    [
      ["seula.config.json", "written"],
      [".github/workflows/seula-ticket-to-spec.yml", "written"],
      [".github/workflows/seula-spec-check.yml", "written"],
      [".seula/spec-template.md", "written"],
    ],
  );
  const cfg = JSON.parse(read(d, "seula.config.json"));
  assert.equal(cfg.specDir, "specs");
  assert.deepEqual(cfg.tracker, { type: "github", states: { needsInput: "seula:needs-input", specReview: "seula:spec-review" }, triggerLabel: "seula:ready-for-spec" });
  assert.equal(cfg.template, ".seula/spec-template.md");

  const caller = read(d, ".github/workflows/seula-ticket-to-spec.yml");
  assert.ok(caller.split("\n").length <= 31, "at most 30 lines");
  assert.match(caller, /types: \[labeled\]/);
  assert.match(caller, /github\.event\.label\.name == 'seula:ready-for-spec'/);
  assert.match(caller, new RegExp(`ticket-to-spec\\.yml@v${seulaVersion().replaceAll(".", "\\.")}`));
  assert.match(read(d, ".github/workflows/seula-spec-check.yml"), /- "specs\/\*\*"/);
});

test("adoption criteria 2-3: Jira callers, and docs/specs is detected", () => {
  const d = repo({ dirs: ["docs/specs"] });
  init({ cwd: d, tracker: "jira", seulaRef: "main" });
  const cfg = JSON.parse(read(d, "seula.config.json"));
  assert.equal(cfg.specDir, "docs/specs");
  assert.deepEqual(cfg.tracker.states, { needsInput: "Needs input", specReview: "Spec review" });
  const caller = read(d, ".github/workflows/seula-ticket-to-spec.yml");
  assert.match(caller, /repository_dispatch:\n {4}types: \[seula-ticket\]/);
  assert.match(caller, /ticket-to-spec\.yml@main/);
  assert.match(read(d, ".github/workflows/seula-spec-check.yml"), /docs\/specs\/\*\*/);
});

test("adoption criterion 5: a repo with SPEC_DRIVEN_DEVELOPMENT.md gets no template", () => {
  const d = repo({ files: { "SPEC_DRIVEN_DEVELOPMENT.md": "# config" } });
  const r = init({ cwd: d, tracker: "github" });
  assert.ok(!existsSync(join(d, ".seula/spec-template.md")));
  assert.equal(JSON.parse(read(d, "seula.config.json")).template, undefined);
  assert.equal(r.files.length, 3);
});

test("adoption criteria 6, 8: existing files are skipped; a second run writes nothing", () => {
  const d = repo();
  init({ cwd: d, tracker: "github" });
  const before = read(d, "seula.config.json");
  const second = init({ cwd: d, tracker: "github" });
  assert.ok(second.files.every((f) => f.action === "skipped"));
  assert.equal(read(d, "seula.config.json"), before);
});

test("adoption criterion 6: --force overwrites", () => {
  const d = repo({ files: { "seula.config.json": "{}" } });
  const r = init({ cwd: d, tracker: "jira", force: true });
  assert.equal(r.files[0]?.action, "overwritten");
  assert.equal(JSON.parse(read(d, "seula.config.json")).tracker.type, "jira");
});

test("adoption edge case: a config without a tracker is skipped with a note", () => {
  const d = repo({ files: { "seula.config.json": '{"specDir":"specs"}' } });
  const r = init({ cwd: d, tracker: "github" });
  assert.equal(r.files[0]?.action, "skipped");
  assert.match(r.files[0]?.note ?? "", /no "tracker" setting/);
});

test("adoption criterion 7: --design-first turns the setting on", () => {
  const d = repo();
  init({ cwd: d, tracker: "github", designFirst: true });
  assert.deepEqual(JSON.parse(read(d, "seula.config.json")).design, { required: true });
});

test("adoption criteria 9-10: next steps list the secrets; nothing secret is written", () => {
  const d = repo();
  const r = init({ cwd: d, tracker: "jira" });
  assert.match(r.nextSteps[0] ?? "", /ANTHROPIC_API_KEY, SEULA_GH_TOKEN, TYPESAFE_API_KEY .*JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN/);
  assert.match(r.nextSteps[1] ?? "", /docs\/setup-jira\.md/);
  for (const f of r.files) assert.doesNotMatch(read(d, f.path), /api[_-]?key"?\s*[:=]\s*"?\w{8,}/i);
});

test("adoption edge case: outside a git repo it still writes, with a warning", () => {
  const d = repo({ git: false });
  const r = init({ cwd: d, tracker: "github" });
  assert.equal(r.files[0]?.action, "written");
  assert.match(r.warnings[0] ?? "", /not a git repository/);
});

test("adoption: invalid options are rejected", () => {
  const d = repo();
  assert.throws(() => init({ cwd: d, tracker: "github", specDir: "../outside" }), /Invalid spec directory/);
  assert.throws(() => init({ cwd: d, tracker: "github", seulaRef: "main; rm -rf /" }), /Invalid seula ref/);
});
