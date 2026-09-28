import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { UsageError } from "../src/errors.ts";
import { init } from "../src/init.ts";

/** A full commit SHA: GitHub Actions accepts only a full SHA in `uses:` (adoption criterion 15). */
const REF = "0123456789abcdef0123456789abcdef01234567";

function repo(opts: { git?: boolean; dirs?: string[]; files?: Record<string, string> } = {}): string {
  const d = mkdtempSync(join(tmpdir(), "seula-init-"));
  if (opts.git !== false) mkdirSync(join(d, ".git"));
  for (const dir of opts.dirs ?? []) mkdirSync(join(d, dir), { recursive: true });
  for (const [f, c] of Object.entries(opts.files ?? {})) writeFileSync(join(d, f), c);
  return d;
}
const read = (d: string, f: string) => readFileSync(join(d, f), "utf8");
// A Windows checkout may have CRLF line endings.
const lf = (text: string) => text.replaceAll("\r\n", "\n");

test("adoption criteria 1-5, 13: a fresh repo gets a config, three caller workflows and a template", () => {
  const d = repo();
  const r = init({ cwd: d, tracker: "github", seulaRef: REF });
  assert.deepEqual(
    r.files.map((f) => [f.path, f.action]),
    [
      ["seula.config.json", "written"],
      [".github/workflows/seula-ticket-to-spec.yml", "written"],
      [".github/workflows/seula-spec-check.yml", "written"],
      [".github/workflows/seula-board-sync.yml", "written"],
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
  assert.match(caller, new RegExp(`ticket-to-spec\\.yml@${REF}`));
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

/** The `secrets:` names that seula's reusable ticket-to-spec workflow declares. */
function declaredSecrets(): string[] {
  const wf = lf(readFileSync(join(import.meta.dirname, "..", ".github", "workflows", "ticket-to-spec.yml"), "utf8"));
  const block = /^ {4}secrets:\n((?: {6}.*\n)+)/m.exec(wf)?.[1] ?? "";
  return [...block.matchAll(/^ {6}(\w+):$/gm)].map((m) => m[1] as string);
}

/** The caller's `secrets:` block as { name seula's workflow gets: repository secret it reads }. */
function passedSecrets(caller: string): Record<string, string> {
  const block = /^ {4}secrets:\n((?: {6}.*\n?)+)/m.exec(lf(caller))?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/^ {6}(\w+): \$\{\{ secrets\.(\w+) \}\}$/gm)].map((m) => [m[1], m[2]]));
}

for (const [tracker, expected] of [
  ["github", { ANTHROPIC_API_KEY: "SEULA_ANTHROPIC_API_KEY", SEULA_GH_TOKEN: "SEULA_GH_TOKEN", TYPESAFE_API_KEY: "SEULA_TYPESAFE_API_KEY" }],
  [
    "jira",
    {
      ANTHROPIC_API_KEY: "SEULA_ANTHROPIC_API_KEY",
      SEULA_GH_TOKEN: "SEULA_GH_TOKEN",
      TYPESAFE_API_KEY: "SEULA_TYPESAFE_API_KEY",
      JIRA_BASE_URL: "JIRA_BASE_URL",
      JIRA_EMAIL: "JIRA_EMAIL",
      JIRA_API_TOKEN: "JIRA_API_TOKEN",
    },
  ],
] as const) {
  test(`adoption criterion 3: the ${tracker} caller passes only seula's secrets, by name, never inherit`, () => {
    const d = repo();
    init({ cwd: d, tracker, seulaRef: REF });
    const caller = read(d, ".github/workflows/seula-ticket-to-spec.yml");
    assert.ok(caller.split("\n").length <= 31, "at most 30 lines");
    assert.doesNotMatch(caller, /^\s*secrets:\s*inherit/m);
    const passed = passedSecrets(caller);
    assert.deepEqual(passed, expected);
    const declared = declaredSecrets();
    for (const name of Object.keys(passed)) assert.ok(declared.includes(name), `seula's workflow declares ${name}`);
  });
}

test("adoption criterion 5: a repo with SPEC_DRIVEN_DEVELOPMENT.md gets no template", () => {
  const d = repo({ files: { "SPEC_DRIVEN_DEVELOPMENT.md": "# config" } });
  const r = init({ cwd: d, tracker: "github", seulaRef: REF });
  assert.ok(!existsSync(join(d, ".seula/spec-template.md")));
  assert.equal(JSON.parse(read(d, "seula.config.json")).template, undefined);
  assert.equal(r.files.length, 4);
});

test("adoption criteria 6, 8: existing files are skipped; a second run writes nothing", () => {
  const d = repo();
  init({ cwd: d, tracker: "github", seulaRef: REF });
  const before = read(d, "seula.config.json");
  const second = init({ cwd: d, tracker: "github", seulaRef: REF });
  assert.ok(second.files.every((f) => f.action === "skipped"));
  assert.equal(read(d, "seula.config.json"), before);
});

test("adoption criterion 6: --force overwrites", () => {
  const d = repo({ files: { "seula.config.json": "{}" } });
  const r = init({ cwd: d, tracker: "jira", force: true, seulaRef: REF });
  assert.equal(r.files[0]?.action, "overwritten");
  assert.equal(JSON.parse(read(d, "seula.config.json")).tracker.type, "jira");
});

test("adoption edge case: a config without a tracker is skipped with a note", () => {
  const d = repo({ files: { "seula.config.json": '{"specDir":"specs"}' } });
  const r = init({ cwd: d, tracker: "github", seulaRef: REF });
  assert.equal(r.files[0]?.action, "skipped");
  assert.match(r.files[0]?.note ?? "", /no "tracker" setting/);
});

test("adoption criterion 7: --design-first turns the setting on", () => {
  const d = repo();
  init({ cwd: d, tracker: "github", designFirst: true, seulaRef: REF });
  assert.deepEqual(JSON.parse(read(d, "seula.config.json")).design, { required: true });
});

test("adoption criteria 9-10: next steps list the secrets the caller reads; nothing secret is written", () => {
  const d = repo();
  const r = init({ cwd: d, tracker: "jira", seulaRef: REF });
  assert.match(r.nextSteps[0] ?? "", /: SEULA_ANTHROPIC_API_KEY, SEULA_GH_TOKEN, SEULA_TYPESAFE_API_KEY .*JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN\.$/);
  assert.match(r.nextSteps[1] ?? "", /docs\/setup-jira\.md/);
  for (const f of r.files) assert.doesNotMatch(read(d, f.path), /api[_-]?key"?\s*[:=]\s*"?\w{8,}/i);
});

test("adoption criterion 9: every secret the caller reads is in the next steps, and no other", () => {
  for (const tracker of ["github", "jira"] as const) {
    const d = repo();
    const r = init({ cwd: d, tracker, seulaRef: REF });
    const listed = [...(r.nextSteps[0] ?? "").matchAll(/\b[A-Z][A-Z_]+[A-Z]\b/g)].map((m) => m[0]);
    const reads = Object.values(passedSecrets(read(d, ".github/workflows/seula-ticket-to-spec.yml")));
    assert.deepEqual(listed.sort(), reads.sort(), tracker);
  }
});

test("adoption edge case: outside a git repo it still writes, with a warning", () => {
  const d = repo({ git: false });
  const r = init({ cwd: d, tracker: "github", seulaRef: REF });
  assert.equal(r.files[0]?.action, "written");
  assert.match(r.warnings[0] ?? "", /not a git repository/);
});

test("adoption: invalid options are rejected", () => {
  const d = repo();
  assert.throws(() => init({ cwd: d, tracker: "github", seulaRef: REF, specDir: "../outside" }), /Invalid spec directory/);
  assert.throws(() => init({ cwd: d, tracker: "github", seulaRef: "main; rm -rf /" }), /Invalid seula ref/);
});

/** The files in a directory, other than .git. */
const filesIn = (d: string): string[] => readdirSync(d, { recursive: true, encoding: "utf8" }).filter((f) => !f.startsWith(".git"));

test("adoption criterion 15: without --seula-ref, init is a usage error and writes no file", () => {
  const d = repo();
  assert.throws(
    () => init({ cwd: d, tracker: "github" }),
    (e) => e instanceof UsageError && /--seula-ref/.test(e.message) && /commit SHA/.test(e.message),
  );
  assert.deepEqual(filesIn(d), []);
});

test("adoption criterion 15: a short SHA is a usage error that asks for the full 40 characters, and writes no file", () => {
  for (const short of ["074c4b0", "0123456789abcdef0123456789abcdef0123456"]) {
    const d = repo();
    assert.throws(
      () => init({ cwd: d, tracker: "jira", seulaRef: short }),
      (e) => e instanceof UsageError && /40/.test(e.message),
      short,
    );
    assert.deepEqual(filesIn(d), [], short);
  }
});

test("adoption criterion 15: a full SHA, a tag or a branch goes into every caller as given", () => {
  for (const ref of [REF, "v0.2.0", "main"]) {
    const d = repo();
    init({ cwd: d, tracker: "jira", seulaRef: ref });
    for (const caller of ["seula-ticket-to-spec.yml", "seula-spec-check.yml", "seula-board-sync.yml"]) {
      const text = lf(read(d, `.github/workflows/${caller}`));
      assert.ok(text.includes(`.yml@${ref}\n`), `${caller} uses @${ref}`);
      assert.ok(text.includes(`seula-ref: ${ref}\n`), `${caller} passes seula-ref ${ref}`);
    }
  }
});

/** The `secrets:` names that seula's reusable board-sync workflow declares. */
function boardSyncSecrets(): string[] {
  const wf = lf(readFileSync(join(import.meta.dirname, "..", ".github", "workflows", "board-sync.yml"), "utf8"));
  const block = /^ {4}secrets:\n((?: {6}.*\n)+)/m.exec(wf)?.[1] ?? "";
  return [...block.matchAll(/^ {6}(\w+):$/gm)].map((m) => m[1] as string);
}

for (const [tracker, expected, permissions] of [
  ["github", {}, ["contents: read", "issues: write"]],
  ["jira", { JIRA_BASE_URL: "JIRA_BASE_URL", JIRA_EMAIL: "JIRA_EMAIL", JIRA_API_TOKEN: "JIRA_API_TOKEN" }, ["contents: read"]],
] as const) {
  test(`adoption criterion 13: the ${tracker} board sync caller runs on pull requests and passes only the tracker's credentials`, () => {
    const d = repo();
    init({ cwd: d, tracker, seulaRef: "main" });
    const caller = lf(read(d, ".github/workflows/seula-board-sync.yml"));
    assert.ok(caller.split("\n").length <= 31, "at most 30 lines");
    assert.match(caller, /^on:\n {2}pull_request:\n {4}types: \[opened, reopened, synchronize, ready_for_review, closed\]$/m);
    assert.match(caller, /uses: JJJohansson\/seula\/\.github\/workflows\/board-sync\.yml@main/);
    assert.match(caller, new RegExp(`tracker: ${tracker}`));
    assert.match(caller, /seula-ref: main/);
    assert.doesNotMatch(caller, /secrets:\s*inherit/);
    assert.deepEqual(passedSecrets(caller), expected);
    for (const name of Object.keys(expected)) assert.ok(boardSyncSecrets().includes(name), `board-sync.yml declares ${name}`);
    const granted = /^permissions:\n((?: {2}.*\n)+)/m.exec(caller)?.[1]?.trim().split("\n").map((l) => l.trim());
    assert.deepEqual(granted, permissions);
  });
}

test("adoption criterion 15: every init command in the docs passes --seula-ref", () => {
  const root = join(import.meta.dirname, "..");
  for (const doc of ["README.md", "docs/setup-jira.md", "docs/setup-github-issues.md", "docs/how-it-works.md"]) {
    const lines = readFileSync(join(root, doc), "utf8").split("\n").filter((l) => /seula init --tracker/.test(l));
    assert.ok(lines.length > 0, `${doc} shows init`);
    for (const line of lines) assert.match(line, /--seula-ref /, `${doc}: ${line.trim()}`);
  }
});
