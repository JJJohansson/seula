import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG, mergeConfig } from "../src/config.ts";
import { jevPlan, planFeedbackLines } from "../src/gates/jevPlan.ts";
import { parseSpec } from "../src/spec.ts";
import { FakeModel, config, fixture } from "./helpers.ts";

const SPEC = fixture("plan-spec.md").replace(/\r\n/g, "\n");
const parsed = () => parseSpec(SPEC, config());
/** A model that answers `yes` for the named questions and 0.05 for the rest. */
const answering = (yes: Record<string, number> = {}) => new FakeModel((_c, q) => yes[q] ?? 0.05);

test("g2 criterion 6: one request with the title, overview, criteria and plan, and the flag questions", async () => {
  const model = answering();
  await jevPlan(parsed(), config(), model);
  assert.equal(model.calls.length, 1);
  const req = model.calls[0];
  const state = req?.state as Record<string, string>;
  assert.equal(state.feature, "FEATURE: Page description");
  assert.match(state.overview ?? "", /short description for search results/);
  assert.match(state.criteria ?? "", /^1\. The page has a description/m);
  assert.match(state.criteria ?? "", /^3\. The description says what the app does\./m);
  assert.match(state.plan ?? "", /1\. Add the description meta tag\./);
  assert.doesNotMatch(state.plan ?? "", /## PLAN/);
  assert.deepEqual(Object.keys(req?.questions ?? {}), ["signIn", "storedData", "personalData"]);
});

test("g2 criterion 7: a flag question passes at or below 1 minus passAt, and a question's own passAt wins", async () => {
  assert.equal((await jevPlan(parsed(), config(), answering({ signIn: 0.25 }))).decision, "pass");
  const flagged = await jevPlan(parsed(), config(), answering({ signIn: 0.3 }));
  assert.equal(flagged.decision, "review");
  assert.deepEqual(flagged.flags.map((f) => f.question), ["signIn"]);
  const strict = config();
  const signIn = strict.g2.questions.signIn;
  assert.ok(signIn);
  strict.g2.questions.signIn = { ...signIn, passAt: 0.9 };
  assert.equal((await jevPlan(parsed(), strict, answering({ signIn: 0.15 }))).decision, "review");
});

test("g2 criteria 7-8: flags make the result unsure, never back, with one line per flag", async () => {
  const r = await jevPlan(parsed(), config(), answering({ signIn: 0.8, personalData: 0.99 }));
  assert.equal(r.decision, "review");
  assert.deepEqual(planFeedbackLines(r), ["plan · signIn: 0.80 → flag", "plan · personalData: 0.99 → flag"]);
  const none = await jevPlan(parsed(), config(), answering());
  assert.equal(none.decision, "pass");
  assert.deepEqual(planFeedbackLines(none), []);
});

test("g2 data schema: g2.questions in the config replaces the whole default set", () => {
  const cfg = mergeConfig(DEFAULT_CONFIG, { g2: { questions: { payments: { instructions: "Does the plan change how payments work?" } } } });
  assert.deepEqual(Object.keys(cfg.g2.questions), ["payments"]);
  assert.deepEqual(Object.keys(config().g2.questions), ["signIn", "storedData", "personalData"]);
});
