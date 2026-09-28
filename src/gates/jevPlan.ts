/**
 * G2, second half: Jev flags a plan that touches a risky area (specs/g2-plan-gate.md criteria
 * 6–8). One request per plan. A flag never sends the plan back: it tells the reviewer where to look.
 */
import type { SeulaConfig } from "../config.ts";
import type { DecisionModel, NoulRequest } from "../jev/model.ts";
import { type ParsedSpec, findSection } from "../spec.ts";

const DEFAULT_PASS_AT = 0.75;

export interface PlanFlag {
  question: string;
  probabilityYes: number;
}

export interface JevPlanResult {
  /** "review" when a question flags the plan; G2's Jev half never gives "back". */
  decision: "pass" | "review";
  flags: PlanFlag[];
  answers: Record<string, number>;
  model: string;
  inputTokens: number;
  costUsd: number;
}

export function planRequest(spec: ParsedSpec, config: SeulaConfig): NoulRequest {
  const questions = Object.fromEntries(
    Object.entries(config.g2.questions).map(([id, q]) => [
      id,
      q.criteria ? { instructions: q.instructions, criteria: q.criteria } : { instructions: q.instructions },
    ]),
  );
  return {
    state: {
      feature: spec.title ?? "(untitled)",
      overview: findSection(spec, "OVERVIEW")?.body.trim() ?? "",
      criteria: spec.criteria.map((c) => `${c.number}. ${c.text}`).join("\n"),
      plan: findSection(spec, "PLAN")?.body.trim() ?? "",
    },
    questions,
  };
}

export async function jevPlan(spec: ParsedSpec, config: SeulaConfig, model: DecisionModel): Promise<JevPlanResult> {
  const res = await model.evaluate(planRequest(spec, config));
  const flags: PlanFlag[] = [];
  for (const [id, q] of Object.entries(config.g2.questions)) {
    const p = res.answers[id] ?? 0;
    if (p > 1 - (q.passAt ?? DEFAULT_PASS_AT) + 1e-9) flags.push({ question: id, probabilityYes: p });
  }
  return {
    decision: flags.length > 0 ? "review" : "pass",
    flags,
    answers: res.answers,
    model: res.model,
    inputTokens: res.inputTokens,
    costUsd: (res.inputTokens / 1_000_000) * config.jev.usdPerMillionInputTokens,
  };
}

/** One line per flag: `plan · <question>: <score> → flag` (criterion 8). */
export function planFeedbackLines(r: JevPlanResult): string[] {
  return r.flags.map((f) => `plan · ${f.question}: ${f.probabilityYes.toFixed(2)} → flag`);
}
