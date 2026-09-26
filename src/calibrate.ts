/**
 * Pick pass/back cut-offs from labeled examples instead of guessing them.
 * Each example is one criterion with the answers a careful human would give.
 */
import { type SeulaConfig, type Thresholds, thresholdsFor } from "./config.ts";
import { type SpecContext, criterionRequest } from "./gates/jevSpec.ts";
import type { DecisionModel } from "./jev/model.ts";
import { goodness, route } from "./routing.ts";

export interface LabeledExample {
  id: string;
  context: SpecContext;
  number?: string;
  criterion: string;
  /** Question id → true if the criterion is good on that question. Unlisted questions are ignored. */
  expect: Record<string, boolean>;
}

export interface LabelsFile {
  examples: LabeledExample[];
}

export interface Metrics {
  /** Good criteria sent back: the costly mistake (wasted agent loops, annoyed humans). */
  falseBlocks: number;
  /** Bad criteria waved through. */
  misses: number;
  /** Share sent to a reviewer or human. */
  reviewRate: number;
}

export interface QuestionCalibration {
  question: string;
  good: number;
  bad: number;
  current: Thresholds & Metrics;
  recommended: Thresholds & Metrics;
  scores: { id: string; goodness: number; expected: boolean }[];
}

export interface CalibrationResult {
  model: string;
  examples: number;
  inputTokens: number;
  questions: QuestionCalibration[];
}

export async function calibrate(labels: LabelsFile, config: SeulaConfig, model: DecisionModel): Promise<CalibrationResult> {
  const byQuestion = new Map<string, { id: string; goodness: number; expected: boolean }[]>();
  let inputTokens = 0;
  let modelName = model.name;

  for (const ex of labels.examples) {
    const res = await model.evaluate(criterionRequest(ex.context, { number: ex.number ?? "1", text: ex.criterion }, config));
    inputTokens += res.inputTokens;
    modelName = res.model;
    for (const [qid, expected] of Object.entries(ex.expect)) {
      const q = config.jev.criterionQuestions[qid];
      const p = res.answers[qid];
      if (!q || p === undefined) continue;
      const list = byQuestion.get(qid) ?? [];
      list.push({ id: ex.id, goodness: goodness(p, q), expected });
      byQuestion.set(qid, list);
    }
  }

  const questions = [...byQuestion.entries()].map(([question, scores]) => {
    const current = thresholdsFor(config, question);
    return {
      question,
      good: scores.filter((s) => s.expected).length,
      bad: scores.filter((s) => !s.expected).length,
      current: { ...current, ...measure(scores, current) },
      recommended: best(scores, current),
      scores,
    };
  });

  return { model: modelName, examples: labels.examples.length, inputTokens, questions };
}

export function measure(scores: { goodness: number; expected: boolean }[], t: Thresholds): Metrics {
  let falseBlocks = 0;
  let misses = 0;
  let review = 0;
  for (const s of scores) {
    const d = route(s.goodness, t);
    if (d === "back" && s.expected) falseBlocks++;
    if (d === "pass" && !s.expected) misses++;
    if (d === "review") review++;
  }
  return { falseBlocks, misses, reviewRate: scores.length ? review / scores.length : 0 };
}

/** Fewest false blocks, then fewest misses, then fewest reviews; ties go to the cut-offs nearest the current ones. */
export function best(scores: { goodness: number; expected: boolean }[], current: Thresholds): Thresholds & Metrics {
  const grid: number[] = [];
  for (let v = 0.05; v <= 0.951; v += 0.05) grid.push(Math.round(v * 100) / 100);
  let winner: (Thresholds & Metrics) | undefined;
  let winnerDist = Number.POSITIVE_INFINITY;
  for (const blockBelow of grid) {
    for (const passAt of grid) {
      if (passAt < blockBelow) continue;
      const m = measure(scores, { passAt, blockBelow });
      const dist = Math.abs(passAt - current.passAt) + Math.abs(blockBelow - current.blockBelow);
      const better =
        !winner ||
        m.falseBlocks < winner.falseBlocks ||
        (m.falseBlocks === winner.falseBlocks && m.misses < winner.misses) ||
        (m.falseBlocks === winner.falseBlocks && m.misses === winner.misses && m.reviewRate < winner.reviewRate) ||
        (m.falseBlocks === winner.falseBlocks && m.misses === winner.misses && m.reviewRate === winner.reviewRate && dist < winnerDist);
      if (better) {
        winner = { passAt, blockBelow, ...m };
        winnerDist = dist;
      }
    }
  }
  return winner ?? { ...current, ...measure(scores, current) };
}

export function calibrationReport(r: CalibrationResult): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const lines = [`Calibrated on ${r.examples} examples with ${r.model} (${r.inputTokens} input tokens).`, ""];
  for (const q of r.questions) {
    lines.push(`${q.question}  (${q.good} good, ${q.bad} bad${q.good < 10 || q.bad < 10 ? " — small sample, treat as a first guess" : ""})`);
    lines.push(
      `  current      pass ≥ ${q.current.passAt.toFixed(2)}  back < ${q.current.blockBelow.toFixed(2)}   false blocks ${q.current.falseBlocks}  misses ${q.current.misses}  unsure ${pct(q.current.reviewRate)}`,
    );
    lines.push(
      `  recommended  pass ≥ ${q.recommended.passAt.toFixed(2)}  back < ${q.recommended.blockBelow.toFixed(2)}   false blocks ${q.recommended.falseBlocks}  misses ${q.recommended.misses}  unsure ${pct(q.recommended.reviewRate)}`,
    );
  }
  const snippet = Object.fromEntries(
    r.questions.map((q) => [q.question, { passAt: q.recommended.passAt, blockBelow: q.recommended.blockBelow }]),
  );
  lines.push("", "To use the recommendations, add to seula.config.json:", JSON.stringify({ jev: { questionThresholds: snippet } }, null, 2));
  return lines.join("\n");
}
