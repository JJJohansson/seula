import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CredentialError } from "../src/errors.ts";
import { criterionRequest, feedbackLines, jevSpec, specContext } from "../src/gates/jevSpec.ts";
import { JevHttpModel, RecordedModel, RecordingModel, requestKey } from "../src/jev/model.ts";
import { combine, goodness, route } from "../src/routing.ts";
import { FakeModel, config, parse } from "./helpers.ts";

test("g1 criteria 12-13: routing: pass, unsure, back", () => {
  const t = { passAt: 0.75, blockBelow: 0.25 };
  assert.equal(route(0.9, t), "pass");
  assert.equal(route(0.75, t), "pass");
  assert.equal(route(0.5, t), "review");
  assert.equal(route(0.24, t), "back");
  assert.equal(goodness(0.9, { good: "no" }).toFixed(2), "0.10");
  assert.equal(combine(["pass", "review", "pass"]), "review");
  assert.equal(combine(["review", "back"]), "back");
});

test("g1 criterion 11: each criterion gets its own request with the spec context", async () => {
  const spec = parse("good-spec.md");
  const model = new FakeModel(() => 0.95);
  const r = await jevSpec(spec, config(), model, { ticket: "Users want CSV export." });
  assert.equal(model.calls.length, 5);
  const state = model.calls[1]?.state as Record<string, string>;
  assert.equal(state.feature, "FEATURE: Export shopping list as CSV");
  assert.match(state.criterion ?? "", /^2\. Clicking it downloads/);
  assert.equal(state.ticket, "Users want CSV export.");
  assert.match(state.outOfScope ?? "", /Other formats/);
  assert.deepEqual(Object.keys(model.calls[0]?.questions ?? {}), ["testable", "unambiguous", "behavior", "inScope"]);
  assert.equal(r.decision, "pass");
  assert.equal(r.inputTokens, 500);
});

test("g1 criteria 13-14: a vague criterion goes back, a borderline one needs review", async () => {
  const spec = parse("good-spec.md");
  const model = new FakeModel((criterion, q) => {
    if (criterion.startsWith("3.") && q === "unambiguous") return 0.1;
    if (criterion.startsWith("5.") && q === "testable") return 0.5;
    return 0.9;
  });
  const r = await jevSpec(spec, config(), model);
  assert.equal(r.decision, "back");
  assert.deepEqual(
    r.criteria.map((c) => c.decision),
    ["pass", "pass", "back", "pass", "review"],
  );
  assert.deepEqual(feedbackLines(r), ["criterion 3 · unambiguous: 0.10 → back", "criterion 5 · testable: 0.50 → review"]);
});

test("g1 criterion 12: per-question thresholds override the default", async () => {
  const cfg = config();
  cfg.jev.questionThresholds.testable = { passAt: 0.4, blockBelow: 0.2 };
  const r = await jevSpec(parse("good-spec.md"), cfg, new FakeModel(() => 0.5));
  const q = r.criteria[0]?.questions;
  assert.equal(q?.find((x) => x.question === "testable")?.decision, "pass");
  assert.equal(q?.find((x) => x.question === "unambiguous")?.decision, "review");
});

test("g1 criterion 16: recording then replaying gives the same answers without a live call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seula-"));
  const file = join(dir, "rec.json");
  const spec = parse("good-spec.md");
  const live = new FakeModel((c) => (c.startsWith("4.") ? 0.3 : 0.8));
  const first = await jevSpec(spec, config(), new RecordingModel(live, file));
  const replay = await jevSpec(spec, config(), new RecordedModel(file));
  assert.deepEqual(replay.criteria, first.criteria);
  assert.equal(live.calls.length, 5);
});

test("g1 criterion 16: a request that wasn't recorded fails clearly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seula-"));
  const model = new RecordedModel(join(dir, "empty.json"));
  const req = criterionRequest(specContext(parse("good-spec.md")), { number: "1", text: "x y z" }, config());
  await assert.rejects(model.evaluate(req), new RegExp(requestKey(req)));
});

test("the HTTP model sends noul questions and reads noul answers", async () => {
  let sent: { url: string; init: RequestInit } | undefined;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    sent = { url, init };
    return new Response(
      JSON.stringify({ model: "jev-1.13.0", answers: { testable: { type: "noul", noul: 0.91 } }, usage: { input_tokens: 42 } }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const m = new JevHttpModel("key-123", config().jev, fakeFetch);
  const r = await m.evaluate({ state: { a: 1 }, questions: { testable: { instructions: "Testable?" } } });
  assert.deepEqual(r, { answers: { testable: 0.91 }, inputTokens: 42, model: "jev-1.13.0" });
  assert.equal(sent?.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal((sent?.init.headers as Record<string, string>).authorization, "Bearer key-123");
  const body = JSON.parse(String(sent?.init.body));
  assert.equal(body.model, "jev-latest");
  assert.deepEqual(body.questions.testable, { type: "noul", instructions: "Testable?" });
});

test("g1 criterion 17: Jev answering 401 or 403 is a refused credential that names TYPESAFE_API_KEY", async () => {
  for (const status of [401, 403]) {
    const fakeFetch = (async () => new Response("unauthorized sekret-key", { status })) as unknown as typeof fetch;
    const m = new JevHttpModel("sekret-key", config().jev, fakeFetch);
    await assert.rejects(m.evaluate({ state: "x", questions: { q: { instructions: "?" } } }), (e) => {
      assert.ok(e instanceof CredentialError);
      assert.match(e.message, /TYPESAFE_API_KEY/);
      assert.match(e.message, new RegExp(`HTTP ${status}`));
      assert.match(e.message, /expired or revoked/);
      assert.ok(!e.message.includes("sekret-key"));
      return true;
    });
  }
});

test("g1 edge case: any other Jev HTTP error stays an internal error", async () => {
  const fakeFetch = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
  const m = new JevHttpModel("k", config().jev, fakeFetch);
  await assert.rejects(m.evaluate({ state: "x", questions: { q: { instructions: "?" } } }), (e) => {
    assert.ok(e instanceof Error);
    assert.ok(!(e instanceof CredentialError));
    assert.match(e.message, /HTTP 500/);
    return true;
  });
});
