import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG, type SeulaConfig } from "../src/config.ts";
import type { DecisionModel, NoulRequest, NoulResult } from "../src/jev/model.ts";
import { type ParsedSpec, parseSpec } from "../src/spec.ts";

export const fixture = (name: string): string => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

export const config = (): SeulaConfig => structuredClone(DEFAULT_CONFIG);

export const parse = (name: string): ParsedSpec => parseSpec(fixture(name), config());

/** A stand-in model: answers each request with a function of the criterion text and question id. */
export class FakeModel implements DecisionModel {
  readonly name = "fake";
  readonly calls: NoulRequest[] = [];
  private readonly answer: (criterion: string, question: string) => number;

  constructor(answer: (criterion: string, question: string) => number) {
    this.answer = answer;
  }

  async evaluate(req: NoulRequest): Promise<NoulResult> {
    this.calls.push(req);
    const criterion = String((req.state as { criterion?: string }).criterion ?? "");
    const answers = Object.fromEntries(Object.keys(req.questions).map((q) => [q, this.answer(criterion, q)]));
    return { answers, inputTokens: 100, model: "fake-1" };
  }
}
