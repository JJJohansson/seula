import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendEvent, backCount, readRun, readRuns, runPath } from "../src/runs.ts";
import { gateTrail, statusTable, waitingLabel } from "../src/status.ts";

const dir = () => mkdtempSync(join(tmpdir(), "seula-runs-"));

test("run-files criteria 1, 3-4, 6, 9: a feature moves through the gates and waits on the right party", () => {
  const d = dir();
  let run = appendEvent(d, "WEB-42", { gate: "G0", result: "pass" }, { title: "Limit upload size" });
  assert.equal(run.step, "spec");
  assert.equal(run.waitingOn, "agent");

  run = appendEvent(d, "WEB-42", { gate: "G1", result: "back", feedback: ["criterion 3 · testable: 0.12 → back"], costUsd: 0.0001 });
  assert.equal(run.step, "spec");
  assert.equal(run.waitingOn, "agent");
  assert.equal(backCount(run, "G1"), 1);

  run = appendEvent(d, "WEB-42", { gate: "G1", result: "pass", costUsd: 0.0001 });
  assert.equal(run.step, "spec review");
  assert.equal(run.waitingOn, "human");
  assert.equal(run.events.at(-1)?.attempt, 2);
  assert.equal(run.cost.jevUsd, 0.0002);
  assert.equal(waitingLabel(run), "→ you: approve spec");
  assert.equal(gateTrail(run), "G0 ✓  G1 ↺✓");

  assert.deepEqual(readRun(d, "WEB-42"), run);
});

test("run-files criterion 4: an unsure result waits on a human", () => {
  const run = appendEvent(dir(), "WEB-7", { gate: "G1", result: "review" });
  assert.equal(run.waitingOn, "human");
  assert.equal(waitingLabel(run), "→ you: review");
});

test("run-files criterion 8: status lists newest first and counts what waits on you", () => {
  const d = dir();
  appendEvent(d, "WEB-1", { gate: "G1", result: "pass" }, { title: "First", now: new Date("2026-09-26T10:00:00Z") });
  appendEvent(d, "WEB-2", { gate: "G0", result: "pass" }, { title: "Second", now: new Date("2026-09-26T11:00:00Z") });
  const runs = readRuns(d);
  assert.deepEqual(
    runs.map((r) => r.id),
    ["WEB-2", "WEB-1"],
  );
  const table = statusTable(runs);
  assert.match(table, /^Waiting on you: 1/);
  assert.match(table, /WEB-1\s+First\s+spec review\s+G1 ✓\s+→ you: approve spec/);
});

test("run-files criterion 5: the third back from one gate blocks the feature for a person", () => {
  const d = dir();
  appendEvent(d, "WEB-9", { gate: "G1", result: "back" }, { maxBacks: 2 });
  let run = appendEvent(d, "WEB-9", { gate: "G1", result: "back" }, { maxBacks: 2 });
  assert.equal(run.blocked, undefined);
  assert.equal(run.waitingOn, "agent");
  run = appendEvent(d, "WEB-9", { gate: "G1", result: "back" }, { maxBacks: 2 });
  assert.match(run.blocked ?? "", /G1 sent this back 3 times \(limit 2\)/);
  assert.equal(run.waitingOn, "human");
  assert.equal(waitingLabel(run), "→ you: loop limit reached");
  run = appendEvent(d, "WEB-9", { gate: "G1", result: "pass" }, { maxBacks: 2 });
  assert.equal(run.blocked, undefined);
});

test("run-files criteria 4, 9: G0 questions wait on the ticket author", () => {
  const run = appendEvent(dir(), "WEB-10", { gate: "G0", result: "back", feedback: ["What exactly must change?"] });
  assert.equal(run.waitingOn, "human");
  assert.equal(waitingLabel(run), "→ you: answer the ticket questions");
});

test("run-files criterion 2: run ids can't escape the runs directory", () => {
  assert.throws(() => runPath("/tmp/x", "../evil"), /Invalid run id/);
});
