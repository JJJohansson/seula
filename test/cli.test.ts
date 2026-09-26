import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { jevSpec } from "../src/gates/jevSpec.ts";
import { RecordingModel } from "../src/jev/model.ts";
import { FakeModel, config, parse } from "./helpers.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const FIXTURES = join(import.meta.dirname, "fixtures");

function run(args: string[], cwd: string) {
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function workdir(): string {
  const d = mkdtempSync(join(tmpdir(), "seula-cli-"));
  copyFileSync(join(FIXTURES, "good-spec.md"), join(d, "good.md"));
  copyFileSync(join(FIXTURES, "bad-spec.md"), join(d, "bad.md"));
  return d;
}

test("g1 criterion 9: check-spec exits 0 for a good spec and 1 for a bad one", () => {
  const d = workdir();
  assert.equal(run(["check-spec", "good.md"], d).code, 0);
  const bad = run(["check-spec", "bad.md"], d);
  assert.equal(bad.code, 1);
  assert.match(bad.stdout, /Result: BACK/);
  const both = run(["check-spec", "good.md", "bad.md"], d);
  assert.equal(both.code, 1);
  assert.match(both.stdout, /1 of 2 specs pass/);
});

test("g1 criteria 10, 15: without a key, gate g1 checks format, skips Jev, and records it", () => {
  const d = workdir();
  const r = run(["gate", "g1", "good.md", "--run", "WEB-1"], d);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /skipped/);
  const runFile = JSON.parse(readFileSync(join(d, ".seula", "runs", "WEB-1.json"), "utf8"));
  assert.equal(runFile.events[0].result, "skipped");
  assert.equal(runFile.title, "Export shopping list as CSV");
  assert.equal(runFile.spec, "good.md");
});

test("g1 criteria 13-14, 16: gate g1 with recorded answers sends a vague criterion back", async () => {
  const d = workdir();
  const rec = join(d, "rec.json");
  const vague = new FakeModel((c, q) => (c.startsWith("4.") && q === "testable" ? 0.1 : 0.9));
  await jevSpec(parse("good-spec.md"), config(), new RecordingModel(vague, rec));

  const r = run(["gate", "g1", "good.md", "--recorded", "rec.json", "--run", "WEB-2"], d);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /criterion 4 · testable: 0\.10 → back/);

  const status = run(["status"], d);
  assert.match(status.stdout, /WEB-2\s+Export shopping list as CSV\s+spec\s+G1 ↺\s+→ agent/);
});

test("run-files criterion 5: gate g1 exits 3 when the loop limit is reached", () => {
  const d = workdir();
  assert.equal(run(["gate", "g1", "bad.md", "--run", "WEB-3"], d).code, 1);
  assert.equal(run(["gate", "g1", "bad.md", "--run", "WEB-3"], d).code, 1);
  const third = run(["gate", "g1", "bad.md", "--run", "WEB-3"], d);
  assert.equal(third.code, 3);
  assert.match(third.stdout, /STOP: G1 sent this back 3 times/);
});

test("g0 criterion 10: gate g0 without a key is skipped", () => {
  const d = workdir();
  writeFileSync(join(d, "ticket.md"), "Recipe scaling: let users cook for more or fewer people.");
  const r = run(["gate", "g0", "--ticket", "ticket.md", "--run", "WEB-4", "--title", "Recipe scaling"], d);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /G0 · Jev · skipped/);
  const runFile = JSON.parse(readFileSync(join(d, ".seula", "runs", "WEB-4.json"), "utf8"));
  assert.equal(runFile.title, "Recipe scaling");
  assert.equal(runFile.step, "spec");
});

test("g0 criteria 1, 10: a too-short ticket goes back even without a key", () => {
  const d = workdir();
  writeFileSync(join(d, "ticket.md"), "Recipe scaling");
  const r = run(["gate", "g0", "--ticket", "ticket.md", "--json"], d);
  assert.equal(r.code, 1);
  assert.match(JSON.parse(r.stdout).asks[0], /too short/);
});

test("g0 criteria 4, 8: gate g0 with recorded answers returns the questions as JSON", async () => {
  const d = workdir();
  const ticket = "Recipe scaling: let users cook for more or fewer people, with quantities recomputed.";
  writeFileSync(join(d, "ticket.md"), ticket);
  const { jevTicket } = await import("../src/gates/jevTicket.ts");
  await jevTicket(ticket, config(), new RecordingModel(new FakeModel((_c, q) => (q === "goal" ? 0.1 : q === "audience" ? 0.9 : 0.05)), join(d, "rec.json")));
  const r = run(["gate", "g0", "--ticket", "ticket.md", "--recorded", "rec.json", "--json"], d);
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, "back");
  assert.deepEqual(out.asks, ["What exactly must change, or what must be added?"]);
});

test("run-files criterion 7: update adds Claude cost and links to a run", () => {
  const d = workdir();
  run(["gate", "g1", "good.md", "--run", "WEB-5"], d);
  const r = run(["update", "--run", "WEB-5", "--claude-usd", "0.42", "--pr-url", "https://github.com/o/r/pull/7"], d);
  assert.equal(r.code, 0);
  const runFile = JSON.parse(readFileSync(join(d, ".seula", "runs", "WEB-5.json"), "utf8"));
  assert.equal(runFile.cost.claudeUsd, 0.42);
  assert.equal(runFile.links.pr, "https://github.com/o/r/pull/7");
  assert.equal(run(["update", "--run", "WEB-5", "--pr-url", "javascript:alert(1)"], d).code, 64);
  assert.equal(run(["update", "--run", "WEB-5", "--claude-usd", "-1"], d).code, 64);
});

test("g1 criterion 9: check-spec skips files in the ignore list", () => {
  const d = workdir();
  writeFileSync(join(d, "seula.config.json"), JSON.stringify({ ignore: ["bad.md"] }));
  const r = run(["check-spec", "good.md", "bad.md"], d);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /1 file\(s\) skipped/);
});

test("g1 criterion 16: an internal error exits 70, not 1, so callers don't mistake it for a gate result", () => {
  const d = workdir();
  writeFileSync(join(d, "empty.json"), JSON.stringify({ version: 1, entries: {} }));
  const r = run(["gate", "g1", "good.md", "--recorded", "empty.json"], d);
  assert.equal(r.code, 70);
  assert.match(r.stderr, /No recorded answer/);
});

test("usage errors exit 64", () => {
  const d = workdir();
  assert.equal(run([], d).code, 64);
  assert.equal(run(["gate", "g9", "good.md"], d).code, 64);
  assert.equal(run(["check-spec"], d).code, 64);
  assert.equal(run(["gate", "g0"], d).code, 64);
  assert.equal(run(["status", "--bogus"], d).code, 64);
});

test("trackers criterion 2: tracker ticket writes the ticket file and prints key and run id", () => {
  const d = workdir();
  writeFileSync(join(d, "event.json"), JSON.stringify({ issue: { number: 7, title: "Dark mode", body: "Follow the OS theme.", html_url: "https://github.com/a/b/issues/7" } }));
  const r = run(["tracker", "ticket", "--tracker", "github", "--event", "event.json", "--out", ".seula/tickets/pending.md"], d);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.stdout), { key: "7", runId: "GH-7", title: "Dark mode", url: "https://github.com/a/b/issues/7" });
  assert.equal(readFileSync(join(d, ".seula/tickets/pending.md"), "utf8"), "# 7: Dark mode\n\nSource: https://github.com/a/b/issues/7\n\nFollow the OS theme.\n");
  writeFileSync(join(d, "bad.json"), JSON.stringify({ client_payload: { key: "nope" } }));
  assert.equal(run(["tracker", "ticket", "--tracker", "jira", "--event", "bad.json", "--out", "x.md"], d).code, 64);
});

test("design-first criterion 5: gate g0 stores the design link in the run file", async () => {
  const d = workdir();
  writeFileSync(join(d, "seula.config.json"), JSON.stringify({ design: { required: true } }));
  const ticket = "Dark mode: follow the OS theme, with a manual toggle in the header. Design: docs/design/dark/";
  writeFileSync(join(d, "ticket.md"), ticket);
  const cfg = config();
  cfg.design.required = true;
  const { jevTicket } = await import("../src/gates/jevTicket.ts");
  await jevTicket(ticket, cfg, new RecordingModel(new FakeModel((_c, q) => ({ goal: 0.95, audience: 0.9, uiChange: 0.95 })[q] ?? 0.05), join(d, "rec.json")));
  const r = run(["gate", "g0", "--ticket", "ticket.md", "--recorded", "rec.json", "--run", "GH-3"], d);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const runFile = JSON.parse(readFileSync(join(d, ".seula", "runs", "GH-3.json"), "utf8"));
  assert.equal(runFile.links.design, "docs/design/dark/");
  const prompt = run(["prompt", "spec-writer", "--run", "GH-3", "--ticket", "ticket.md"], d);
  assert.match(prompt.stdout, /The ticket links this design: docs\/design\/dark\//);
});

test("config prints the effective configuration", () => {
  const d = workdir();
  writeFileSync(join(d, "seula.config.json"), JSON.stringify({ specDir: "docs/specs", tracker: { type: "jira" } }));
  const cfg = JSON.parse(run(["config"], d).stdout);
  assert.equal(cfg.specDir, "docs/specs");
  assert.equal(cfg.tracker.type, "jira");
  assert.equal(cfg.maxBacks, 2);
});
