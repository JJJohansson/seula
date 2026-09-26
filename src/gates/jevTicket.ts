/**
 * G0: is the ticket ready to write a spec from? One Jev request with all ticket questions.
 * A too-short ticket goes back without calling Jev (specs/g0-ticket-gate.md).
 * With `design.required`, a UI ticket must also link a design (specs/design-first.md).
 */
import { type NoulQuestion, type SeulaConfig, type TicketQuestion, thresholdsFor } from "../config.ts";
import type { DecisionModel } from "../jev/model.ts";
import { type Decision, goodness, route } from "../routing.ts";

export interface TicketQuestionOutcome {
  question: string;
  onFail: TicketQuestion["onFail"] | "design";
  probabilityYes: number;
  goodness: number;
  /** How Jev's answer routed on its own, before `onFail` is applied. */
  routed: Decision;
  message: string;
}

export interface JevTicketResult {
  decision: Decision;
  /** Questions to post back on the ticket when the decision is "back". */
  asks: string[];
  /** Notes for the person reviewing the ticket or the spec. */
  notes: string[];
  /** The first design link in the ticket, when design-first is on. */
  designLink?: string;
  questions: TicketQuestionOutcome[];
  model: string;
  inputTokens: number;
  costUsd: number;
}

export const TOO_SHORT_ASK = "The ticket is too short to write a spec from. Describe the goal in a few sentences.";
export const DESIGN_ASK = "This ticket changes the UI. Link the approved design before a spec is written.";
export const DESIGN_UNSURE_NOTE = "A person must decide whether this ticket needs a design.";

/** design-first criterion 2. Asked in the same request as the other ticket questions (criterion 6). */
export const UI_CHANGE_QUESTION: NoulQuestion = {
  instructions: "Does the ticket add a screen, or change what a screen shows or how it is laid out?",
  criteria: {
    true: "Adds a screen, or changes visible content or layout",
    false: "No visible UI change: only logic, data, an API, or tooling",
  },
};

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** The first token in the text that contains one of the patterns, e.g. "docs/design/scaling/". */
export function findDesignLink(text: string, patterns: string[]): string | undefined {
  for (const token of text.match(/[^\s()<>[\]"'`]+/g) ?? []) {
    if (patterns.some((p) => p && token.includes(p))) {
      const link = token.replace(/[.,;:!?]+$/, "");
      return link.length <= 300 ? link : undefined;
    }
  }
  return undefined;
}

export async function jevTicket(ticket: string, config: SeulaConfig, model: DecisionModel): Promise<JevTicketResult> {
  if (wordCount(ticket) < config.minTicketWords) {
    return { decision: "back", asks: [TOO_SHORT_ASK], notes: [], questions: [], model: "none", inputTokens: 0, costUsd: 0 };
  }

  const designOn = config.design.required;
  const toRequest = (q: NoulQuestion) => (q.criteria ? { instructions: q.instructions, criteria: q.criteria } : { instructions: q.instructions });
  const questions = Object.fromEntries(Object.entries(config.jev.ticketQuestions).map(([id, q]) => [id, toRequest(q)]));
  if (designOn) questions.uiChange = toRequest(UI_CHANGE_QUESTION);
  const res = await model.evaluate({ state: { ticket: ticket.trim() }, questions });

  const outcomes: TicketQuestionOutcome[] = Object.entries(config.jev.ticketQuestions).map(([id, q]) => {
    const p = res.answers[id] ?? 0;
    const g = goodness(p, q);
    return { question: id, onFail: q.onFail, probabilityYes: p, goodness: g, routed: route(g, thresholdsFor(config, id)), message: q.message };
  });

  const asks: string[] = [];
  const notes: string[] = [];
  let decision: Decision = "pass";
  for (const o of outcomes) {
    if (o.routed === "pass") continue;
    if (o.onFail === "flag") {
      notes.push(o.message);
    } else if (o.onFail === "back" && o.routed === "back") {
      asks.push(o.message);
      decision = "back";
    } else {
      // An unsure "back" question, or any "review" question: a person decides.
      notes.push(o.onFail === "review" ? o.message : `Unsure: ${o.message}`);
      if (decision !== "back") decision = "review";
    }
  }

  let designLink: string | undefined;
  if (designOn) {
    designLink = findDesignLink(ticket, config.design.linkPatterns);
    const p = res.answers.uiChange ?? 0;
    const routed = route(p, thresholdsFor(config, "uiChange"));
    outcomes.push({ question: "uiChange", onFail: "design", probabilityYes: p, goodness: p, routed, message: DESIGN_ASK });
    // A ticket that already goes back (e.g. no clear goal) gets that question first (criterion 6).
    if (!designLink && decision !== "back") {
      if (routed === "pass") {
        asks.push(DESIGN_ASK);
        decision = "back";
      } else if (routed === "review") {
        notes.push(DESIGN_UNSURE_NOTE);
        decision = "review";
      }
    }
  }

  return {
    decision,
    asks,
    notes,
    ...(designLink ? { designLink } : {}),
    questions: outcomes,
    model: res.model,
    inputTokens: res.inputTokens,
    costUsd: (res.inputTokens / 1_000_000) * config.jev.usdPerMillionInputTokens,
  };
}
