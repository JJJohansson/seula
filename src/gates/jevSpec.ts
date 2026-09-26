/**
 * G1, second half: Jev answers yes/no questions about each acceptance criterion.
 * Each criterion is one request; all its questions are answered in parallel by Jev.
 */
import { type SeulaConfig, thresholdsFor } from "../config.ts";
import type { DecisionModel, NoulRequest } from "../jev/model.ts";
import { type Decision, combine, goodness, route } from "../routing.ts";
import { type Criterion, type ParsedSpec, findSection } from "../spec.ts";

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

export function criterionRequest(ctx: SpecContext, criterion: Pick<Criterion, "number" | "text">, config: SeulaConfig): NoulRequest {
  const questions = Object.fromEntries(
    Object.entries(config.jev.criterionQuestions).map(([id, q]) => [
      id,
      q.criteria ? { instructions: q.instructions, criteria: q.criteria } : { instructions: q.instructions },
    ]),
  );
  return { state: { ...ctx, criterion: `${criterion.number}. ${criterion.text}` }, questions };
}

export async function jevSpec(
  spec: ParsedSpec,
  config: SeulaConfig,
  model: DecisionModel,
  opts: { ticket?: string } = {},
): Promise<JevSpecResult> {
  const ctx = specContext(spec, opts.ticket);
  let inputTokens = 0;
  let modelName = model.name;
  const criteria: CriterionOutcome[] = [];

  for (const c of spec.criteria) {
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

  return {
    decision: criteria.length ? combine(criteria.map((c) => c.decision)) : "back",
    criteria,
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
