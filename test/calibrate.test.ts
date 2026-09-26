import assert from "node:assert/strict";
import { test } from "node:test";
import { best, calibrate, calibrationReport, measure } from "../src/calibrate.ts";
import { FakeModel, config } from "./helpers.ts";

const ctx = { feature: "X", overview: "A feature." };

test("calibration criterion 3: measure counts false blocks, misses and unsure answers", () => {
  const scores = [
    { goodness: 0.9, expected: true },
    { goodness: 0.2, expected: true }, // false block
    { goodness: 0.8, expected: false }, // miss
    { goodness: 0.5, expected: false }, // unsure
  ];
  assert.deepEqual(measure(scores, { passAt: 0.75, blockBelow: 0.25 }), { falseBlocks: 1, misses: 1, reviewRate: 0.25 });
});

test("calibration criterion 4: best avoids false blocks first", () => {
  const scores = [
    { goodness: 0.3, expected: true },
    { goodness: 0.95, expected: true },
    { goodness: 0.1, expected: false },
    { goodness: 0.6, expected: false },
  ];
  const r = best(scores, { passAt: 0.75, blockBelow: 0.25 });
  assert.equal(r.falseBlocks, 0);
  assert.equal(r.misses, 0);
  assert.ok(r.blockBelow <= 0.3 && r.blockBelow > 0.1);
  assert.ok(r.passAt > 0.6 && r.passAt <= 0.95);
});

test("calibration criteria 1-3, 5-6: calibrate runs every example and reports per question", async () => {
  const model = new FakeModel((criterion) => (criterion.includes("vague") ? 0.15 : 0.9));
  const r = await calibrate(
    {
      examples: [
        { id: "a", context: ctx, criterion: "The list shows five items.", expect: { testable: true, unambiguous: true } },
        { id: "b", context: ctx, criterion: "It should feel vague and nice.", expect: { testable: false, unambiguous: false } },
        { id: "c", context: ctx, criterion: "Sorted by name, A to Z.", expect: { unambiguous: true } },
      ],
    },
    config(),
    model,
  );
  assert.equal(model.calls.length, 3);
  const unambiguous = r.questions.find((q) => q.question === "unambiguous");
  assert.equal(unambiguous?.good, 2);
  assert.equal(unambiguous?.bad, 1);
  assert.equal(unambiguous?.recommended.falseBlocks, 0);
  assert.equal(unambiguous?.recommended.misses, 0);
  const report = calibrationReport(r);
  assert.match(report, /small sample/);
  assert.match(report, /"questionThresholds"/);
});
