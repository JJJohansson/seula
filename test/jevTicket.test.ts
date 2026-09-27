import assert from "node:assert/strict";
import { test } from "node:test";
import { jevTicket, wordCount } from "../src/gates/jevTicket.ts";
import { FakeModel, config } from "./helpers.ts";

const TICKET = "Let users view a recipe at a different number of servings, with ingredient quantities recomputed.";

/** Answers per question id; anything not listed gets a clearly good answer. */
function model(answers: Record<string, number>) {
  const goodDefault: Record<string, number> = { goal: 0.95, contradiction: 0.03, agentInstructions: 0.02, sensitive: 0.05, audience: 0.9 };
  return new FakeModel((_c, q) => answers[q] ?? goodDefault[q] ?? 0.5);
}

test("g0 criterion 2: a clear ticket passes in one request", async () => {
  const m = model({});
  const r = await jevTicket(TICKET, config(), m);
  assert.equal(r.decision, "pass");
  assert.equal(m.calls.length, 1);
  assert.deepEqual((m.calls[0]?.state as { ticket: string }).ticket, TICKET);
  assert.deepEqual(Object.keys(m.calls[0]?.questions ?? {}), ["goal", "contradiction", "agentInstructions", "sensitive", "audience"]);
});

test("g0 criterion 1: a too-short ticket goes back without calling Jev", async () => {
  const m = model({});
  const r = await jevTicket("Recipe scaling", config(), m);
  assert.equal(r.decision, "back");
  assert.equal(m.calls.length, 0);
  assert.match(r.asks[0] ?? "", /too short/);
});

test("g0 criterion 4: a missing goal goes back with a question for the ticket", async () => {
  const r = await jevTicket(TICKET, config(), model({ goal: 0.1 }));
  assert.equal(r.decision, "back");
  assert.deepEqual(r.asks, ["What exactly must change, or what must be added?"]);
});

test("g0 criteria 5, 7: instructions aimed at the agent stop for a person, never auto-pass", async () => {
  const r = await jevTicket(TICKET, config(), model({ agentInstructions: 0.97 }));
  assert.equal(r.decision, "review");
  assert.match(r.notes[0] ?? "", /tries to direct the agent/);
});

test("g0 criterion 6: flags only add notes", async () => {
  const r = await jevTicket(TICKET, config(), model({ sensitive: 0.9, audience: 0.1 }));
  assert.equal(r.decision, "pass");
  assert.equal(r.notes.length, 2);
});

test("g0 criterion 5: an unsure goal needs a person; a clear back still wins", async () => {
  assert.equal((await jevTicket(TICKET, config(), model({ goal: 0.5 }))).decision, "review");
  assert.equal((await jevTicket(TICKET, config(), model({ goal: 0.5, contradiction: 0.9 }))).decision, "back");
});

test("word count ignores punctuation-only tokens", () => {
  assert.equal(wordCount("Add — a CSV export, please !"), 5);
});

// design-first (specs/design-first.md)

function designConfig() {
  const cfg = config();
  cfg.design.required = true;
  return cfg;
}

test("design-first criterion 1: off by default, no extra question", async () => {
  const m = model({ uiChange: 0.99 });
  const r = await jevTicket(TICKET, config(), m);
  assert.equal(r.decision, "pass");
  assert.ok(!("uiChange" in (m.calls[0]?.questions ?? {})));
  assert.equal(r.designLink, undefined);
});

test("design-first criteria 2-3: a UI ticket without a design link goes back", async () => {
  const m = model({ uiChange: 0.95 });
  const r = await jevTicket(TICKET, designConfig(), m);
  assert.ok("uiChange" in (m.calls[0]?.questions ?? {}));
  assert.equal(r.decision, "back");
  assert.deepEqual(r.asks, ["This ticket changes the UI. Link the approved design before a spec is written."]);
});

test("design-first criterion 4: unsure whether it changes the UI needs a person", async () => {
  const r = await jevTicket(TICKET, designConfig(), model({ uiChange: 0.5 }));
  assert.equal(r.decision, "review");
  assert.deepEqual(r.notes, ["A person must decide whether this ticket needs a design."]);
});

test("design-first criterion 5: a linked design is stored and not asked for", async () => {
  const r = await jevTicket(`${TICKET} Design: docs/design/recipe-scaling/.`, designConfig(), model({ uiChange: 0.95 }));
  assert.equal(r.decision, "pass");
  assert.equal(r.designLink, "docs/design/recipe-scaling/");
  const fig = await jevTicket(`${TICKET} See [the mockup](https://www.figma.com/design/abc/Scaling).`, designConfig(), model({ uiChange: 0.95 }));
  assert.equal(fig.designLink, "https://www.figma.com/design/abc/Scaling");
});

test("design-first criterion 6: a ticket without a clear goal goes back for the goal first", async () => {
  const r = await jevTicket(TICKET, designConfig(), model({ goal: 0.1, uiChange: 0.95 }));
  assert.equal(r.decision, "back");
  assert.deepEqual(r.asks, ["What exactly must change, or what must be added?"]);
});

test("design-first edge case: a non-UI ticket with a design link keeps the link", async () => {
  const r = await jevTicket(`${TICKET} docs/design/x/`, designConfig(), model({ uiChange: 0.05 }));
  assert.equal(r.decision, "pass");
  assert.equal(r.designLink, "docs/design/x/");
});

test("g0 criterion 11: the default contradiction question counts a later comment as a replacement", () => {
  const q = config().jev.ticketQuestions.contradiction;
  assert.ok(q);
  assert.match(q.instructions, /A later comment can change a requirement/);
  assert.match(q.instructions, /Count that change as a replacement, not as a conflict\./);
  assert.match(q.criteria?.false ?? "", /replaces/);
});
