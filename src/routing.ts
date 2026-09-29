/** How every Jev answer becomes pass, back or unsure (docs/quality-gates.md, "Routing"). */
import type { NoulQuestion, Thresholds } from "./config.ts";

/** pass: move on. back: return to the agent that wrote it. review: unsure, a reviewer or human decides. */
export type Decision = "pass" | "back" | "review";

/** How good the answer is, 0–1, regardless of which way the question is phrased. */
export function goodness(probabilityYes: number, question: Pick<NoulQuestion, "good">): number {
  return question.good === "no" ? 1 - probabilityYes : probabilityYes;
}

/** At or above `passAt` passes, below `blockBelow` goes back, and between is unsure (g1 criterion 12). */
export function route(good: number, t: Thresholds): Decision {
  if (good >= t.passAt) return "pass";
  if (good < t.blockBelow) return "back";
  return "review";
}

/** The worst decision wins: any back sends the work back; otherwise any review needs a reviewer. */
export function combine(decisions: Decision[]): Decision {
  if (decisions.includes("back")) return "back";
  if (decisions.includes("review")) return "review";
  return "pass";
}
