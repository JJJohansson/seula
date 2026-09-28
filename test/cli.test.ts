import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
  // Tests never reach a real service.
  for (const key of ["TYPESAFE_API_KEY", "JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "GITHUB_TOKEN"]) delete env[key];
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

test("trackers criterion 10: tracker comments needs a key and a file, and writes nothing without credentials", () => {
  const d = workdir();
  writeFileSync(join(d, "MP-7.md"), "# MP-7: X\n");
  assert.equal(run(["tracker", "comments", "--tracker", "jira", "--append", "MP-7.md"], d).code, 64);
  assert.equal(run(["tracker", "comments", "--tracker", "jira", "--key", "MP-7"], d).code, 64);
  const r = run(["tracker", "comments", "--tracker", "jira", "--key", "MP-7", "--append", "MP-7.md"], d);
  assert.equal(r.code, 64, r.stderr);
  assert.match(r.stderr, /JIRA_BASE_URL/);
  assert.equal(readFileSync(join(d, "MP-7.md"), "utf8"), "# MP-7: X\n");
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

test("run-files criterion 10: update --claude-result stores the breakdown, and a bad file stores nothing but keeps the rest", () => {
  const d = workdir();
  run(["gate", "g1", "good.md", "--run", "WEB-6"], d);
  writeFileSync(join(d, "claude.json"), JSON.stringify({ total_cost_usd: 0.5, num_turns: 12, duration_ms: 60000, result: "text" }));
  assert.equal(run(["update", "--run", "WEB-6", "--claude-result", "claude.json"], d).code, 0);
  let runFile = JSON.parse(readFileSync(join(d, ".seula", "runs", "WEB-6.json"), "utf8"));
  assert.equal(runFile.cost.claudeUsd, 0.5);
  assert.equal(runFile.cost.claudeRuns[0].turns, 12);

  writeFileSync(join(d, "broken.json"), "Claude Code refused to start");
  const r = run(["update", "--run", "WEB-6", "--claude-result", "broken.json", "--pr-url", "https://github.com/o/r/pull/8"], d);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /broken\.json/);
  runFile = JSON.parse(readFileSync(join(d, ".seula", "runs", "WEB-6.json"), "utf8"));
  assert.equal(runFile.cost.claudeRuns.length, 1, "nothing stored from the bad file");
  assert.equal(runFile.links.pr, "https://github.com/o/r/pull/8", "the other options still apply");
  assert.equal(run(["update", "--run", "WEB-6", "--claude-result", "missing.json"], d).code, 0);

  // Both would count one run's cost twice.
  assert.equal(run(["update", "--run", "WEB-6", "--claude-result", "claude.json", "--claude-usd", "0.5"], d).code, 64);
});

/** Runs the CLI against a local server that refuses every request with `status`. */
async function runAgainstRefusal(status: number, args: string[], cwd: string, extraEnv: (url: string) => Record<string, string>) {
  const server = createServer((_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "refused" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  for (const key of ["TYPESAFE_API_KEY", "JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "GITHUB_TOKEN"]) delete env[key];
  try {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...env, ...extraEnv(url) } });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    return { code, stderr };
  } finally {
    server.close();
  }
}

function jevAt(d: string, url: string): Record<string, string> {
  writeFileSync(join(d, "seula.config.json"), JSON.stringify({ jev: { endpoint: `${url}/v1/systemone` } }));
  return { TYPESAFE_API_KEY: "sekret-key" };
}

test("g0 criterion 12: gate g0 exits 77 when Jev refuses the key", async () => {
  const d = workdir();
  writeFileSync(join(d, "ticket.md"), "# WEB-9: Export\n\nUsers need to export the shopping list as a CSV file from the list page.\n");
  const r = await runAgainstRefusal(401, ["gate", "g0", "--ticket", "ticket.md"], d, (url) => jevAt(d, url));
  assert.equal(r.code, 77);
  assert.match(r.stderr, /TYPESAFE_API_KEY/);
  assert.ok(!r.stderr.includes("sekret-key"));
});

test("g1 criterion 17: gate g1 exits 77 when Jev refuses the key", async () => {
  const d = workdir();
  const r = await runAgainstRefusal(403, ["gate", "g1", "good.md"], d, (url) => jevAt(d, url));
  assert.equal(r.code, 77);
  assert.match(r.stderr, /TYPESAFE_API_KEY/);
});

test("trackers criterion 9: a tracker command exits 77 when the tracker refuses the credential", async () => {
  const d = workdir();
  writeFileSync(join(d, "c.md"), "Hello");
  const r = await runAgainstRefusal(401, ["tracker", "comment", "--tracker", "github", "--key", "1", "--text-file", "c.md"], d, (url) => ({
    GITHUB_TOKEN: "ghs_sekret",
    GITHUB_REPOSITORY: "acme/app",
    GITHUB_API_URL: url,
  }));
  assert.equal(r.code, 77);
  assert.match(r.stderr, /GITHUB_TOKEN/);
  assert.ok(!r.stderr.includes("ghs_sekret"));
});

/** Runs the CLI against a local fake GitHub API that answers every request with `status` and `body`, and records the requests. */
async function runAgainstGitHub(status: number, body: unknown, args: string[], cwd: string) {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const env = { ...process.env };
  for (const key of ["TYPESAFE_API_KEY", "JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "GITHUB_TOKEN"]) delete env[key];
  try {
    const extra = { GITHUB_TOKEN: "ghs_x", GITHUB_REPOSITORY: "acme/app", GITHUB_API_URL: `http://127.0.0.1:${port}` };
    const child = spawn(process.execPath, [CLI, "tracker", "--tracker", "github", ...args], { cwd, env: { ...env, ...extra } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    return { code, stdout, stderr, requests };
  } finally {
    server.close();
  }
}

const NEEDS_INPUT = { labels: [{ name: "seula:needs-input" }] };

test("trackers criterion 14: tracker state prints key, status and state as a JSON line", async () => {
  const r = await runAgainstGitHub(200, NEEDS_INPUT, ["state", "--key", "1"], workdir());
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { key: "1", status: "seula:needs-input", state: "needsInput" });
  assert.deepEqual(r.requests, ["GET /repos/acme/app/issues/1"]);
});

test("trackers criterion 14: --fail-on exits 1 in that state and names the key and the state, else 0", async () => {
  const d = workdir();
  const failed = await runAgainstGitHub(200, NEEDS_INPUT, ["state", "--key", "1", "--fail-on", "needsInput"], d);
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /\b1\b/);
  assert.match(failed.stderr, /needsInput/);
  const passed = await runAgainstGitHub(200, { labels: [{ name: "seula:spec-review" }] }, ["state", "--key", "1", "--fail-on", "needsInput"], d);
  assert.equal(passed.code, 0, passed.stderr);
});

test("trackers criterion 15: move --state planning without the setting calls no API, says so, and exits 0", async () => {
  const r = await runAgainstGitHub(200, {}, ["move", "--key", "1", "--state", "planning"], workdir());
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /tracker\.states\.planning/);
  assert.deepEqual(r.requests, []);
});

test("trackers criteria 6 and 14: --state and --fail-on accept only needsInput, specReview and planning", async () => {
  const d = workdir();
  assert.equal((await runAgainstGitHub(200, {}, ["move", "--key", "1", "--state", "done"], d)).code, 64);
  assert.equal((await runAgainstGitHub(200, NEEDS_INPUT, ["state", "--key", "1", "--fail-on", "done"], d)).code, 64);
});

test("trackers criterion 14: tracker state needs a key", () => {
  assert.equal(run(["tracker", "state", "--tracker", "github"], workdir()).code, 64);
});

test("trackers criterion 16: --branch reads the ticket named by a seula branch", async () => {
  const r = await runAgainstGitHub(200, NEEDS_INPUT, ["state", "--branch", "seula/gh-1"], workdir());
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).key, "1");
  assert.deepEqual(r.requests, ["GET /repos/acme/app/issues/1"]);
});

test("trackers criterion 16: a branch with no key, or both --key and --branch, exits 64 before any API call", async () => {
  const d = workdir();
  for (const args of [
    ["state", "--branch", "seula/notes"],
    ["move", "--branch", "feature/gh-1", "--state", "specReview"],
    ["state", "--key", "1", "--branch", "seula/gh-1"],
  ]) {
    const r = await runAgainstGitHub(200, NEEDS_INPUT, args, d);
    assert.equal(r.code, 64, args.join(" "));
    assert.deepEqual(r.requests, [], args.join(" "));
  }
});

test("g2 criteria 8-9: gate g2 exits 0 with Jev skipped when the rules pass, and 1 with plan lines when one fails", () => {
  const d = workdir();
  copyFileSync(join(FIXTURES, "plan-spec.md"), join(d, "plan.md"));
  const ok = run(["gate", "g2", "plan.md"], d);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /Jev.*skipped/i);
  writeFileSync(join(d, "gap.md"), readFileSync(join(d, "plan.md"), "utf8").replace("Criteria: 3.", "Criteria: 2."));
  const gap = run(["gate", "g2", "gap.md"], d);
  assert.equal(gap.code, 1);
  assert.match(gap.stdout, /^plan · coverage: .*criterion 3/m);
});

test("g2: gate g2 without a file exits 64, and an unknown gate lists g2", () => {
  const d = workdir();
  assert.equal(run(["gate", "g2"], d).code, 64);
  const unknown = run(["gate", "g9", "x.md"], d);
  assert.equal(unknown.code, 64);
  assert.match(unknown.stderr, /g2/);
});

test("agent-plugin criterion 12: seula prompt planner prints the prompt; a missing option or an unknown prompt exits 64", () => {
  const d = workdir();
  const args = ["prompt", "planner", "--run", "MEAL-4", "--spec", "specs/page-description.md", "--approved", ".seula/approved/page-description.md"];
  const r = run(args, d);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Spec file: specs\/page-description\.md/);
  assert.equal(run(args.slice(0, -2), d).code, 64);
  const unknown = run(["prompt", "painter"], d);
  assert.equal(unknown.code, 64);
  assert.match(unknown.stderr, /planner/);
});
