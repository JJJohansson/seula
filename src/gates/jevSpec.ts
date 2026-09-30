/**
 * G1, second half: Jev answers yes/no questions about each acceptance criterion.
 * Each criterion is one request; all its questions are answered in parallel by Jev.
 */
import { type SeulaConfig, thresholdsFor } from "../config.ts";
import type { DecisionModel, NoulRequest } from "../jev/model.ts";
import { type Decision, combine, goodness, route } from "../routing.ts";
import { type Criterion, type ParsedSpec, findSection } from "../spec.ts";
import { changedCriteria } from "../specDiff.ts";

export interface QuestionOutcome {
  question: string;
  probabilityYes: number;
  goodness: number;
  decision: Decision;
}

export interface CriterionOutcome {
  number: string;
  text: string;
  line: number;
  decision: Decision;
  questions: QuestionOutcome[];
}

export interface JevSpecResult {
  decision: Decision;
  criteria: CriterionOutcome[];
  /** With a base version: how many unchanged criteria were not sent to Jev (criterion 19). Else 0. */
  unchanged: number;
  model: string;
  inputTokens: number;
  costUsd: number;
}

export interface SpecContext {
  feature: string;
  overview: string;
  intent?: string;
  outOfScope?: string;
  ticket?: string;
}

/** The parts of the spec Jev sees alongside each criterion. Kept small: Jev reads, it doesn't reason at length. */
export function specContext(spec: ParsedSpec, ticket?: string): SpecContext {
  const body = (name: string) => findSection(spec, name)?.body.trim() || undefined;
  return {
    feature: spec.title ?? "(untitled)",
    overview: body("OVERVIEW") ?? "",
    intent: body("WHY"),
    outOfScope: body("OUT OF SCOPE"),
    ticket: ticket?.trim() || undefined,
  };
}

/** One Jev request: the spec's context and one criterion, with every configured criterion question (g1 criterion 11). */
export function criterionRequest(ctx: SpecContext, criterion: Pick<Criterion, "number" | "text">, config: SeulaConfig): NoulRequest {
  const questions = Object.fromEntries(
    Object.entries(config.jev.criterionQuestions).map(([id, q]) => [
      id,
      q.criteria ? { instructions: q.instructions, criteria: q.criteria } : { instructions: q.instructions },
    ]),
  );
  return { state: { ...ctx, criterion: `${criterion.number}. ${criterion.text}` }, questions };
}

/**
 * G1's Jev half: one request per criterion, each answer routed, and the worst result wins (g1
 * criteria 11-14). With `base`, only the changed criteria are sent (criterion 19).
 */
export async function jevSpec(
  spec: ParsedSpec,
  config: SeulaConfig,
  model: DecisionModel,
  opts: { ticket?: string; base?: ParsedSpec } = {},
): Promise<JevSpecResult> {
  const ctx = specContext(spec, opts.ticket);
  let inputTokens = 0;
  let modelName = model.name;
  const criteria: CriterionOutcome[] = [];
  const changed = changedCriteria(spec, opts.base);
  const toCheck = spec.criteria.filter((c) => changed.has(c.number));

  for (const c of toCheck) {
    const res = await model.evaluate(criterionRequest(ctx, c, config));
    inputTokens += res.inputTokens;
    modelName = res.model;
    const questions: QuestionOutcome[] = Object.entries(config.jev.criterionQuestions).map(([id, q]) => {
      const p = res.answers[id] ?? 0;
      const g = goodness(p, q);
      return { question: id, probabilityYes: p, goodness: g, decision: route(g, thresholdsFor(config, id)) };
    });
    criteria.push({
      number: c.number,
      text: c.text,
      line: c.line,
      decision: combine(questions.map((q) => q.decision)),
      questions,
    });
  }

  // No criteria at all is a spec error, but no changed criteria with a base version is a pass.
  const none: Decision = opts.base ? "pass" : "back";
  return {
    decision: criteria.length ? combine(criteria.map((c) => c.decision)) : none,
    criteria,
    unchanged: spec.criteria.length - toCheck.length,
    model: modelName,
    inputTokens,
    costUsd: (inputTokens / 1_000_000) * config.jev.usdPerMillionInputTokens,
  };
}

/** One line per question that didn't pass: the feedback the writing agent gets. */
export function feedbackLines(result: JevSpecResult): string[] {
  return result.criteria.flatMap((c) =>
    c.questions
      .filter((q) => q.decision !== "pass")
      .map((q) => `criterion ${c.number} · ${q.question}: ${q.goodness.toFixed(2)} → ${q.decision}`),
  );
}
