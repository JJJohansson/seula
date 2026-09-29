import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { DEFAULT_CONFIG, type SeulaConfig } from "../src/config.ts";
import type { DecisionModel, NoulRequest, NoulResult } from "../src/jev/model.ts";
import { type ParsedSpec, parseSpec } from "../src/spec.ts";

export const fixture = (name: string): string => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

export const config = (): SeulaConfig => structuredClone(DEFAULT_CONFIG);

/**
 * The workflow script tests need bash: Linux or macOS bash, or Git Bash on Windows. WSL's
 * bash.exe doesn't count: it runs Linux, which can't use the Windows paths the tests pass.
 */
export const hasBash = ((): boolean => {
  const r = spawnSync("bash", ["--version"], { encoding: "utf8" });
  if (r.status !== 0) return false;
  return process.platform !== "win32" || /-pc-(msys|cygwin)/.test(r.stdout ?? "");
})();

/** Many workflow scripts use jq, as GitHub's Ubuntu runner has it. */
export const hasJq = hasBash && spawnSync("jq", ["--version"]).status === 0;

// On Windows, jq.exe writes CRLF line ends, which the runner's jq never does: a `while read`
// loop would then see "file.md\r". A shim first on the PATH gives jq -b (binary, LF only), so
// the workflow scripts see what they see on the runner.
if (hasJq && process.platform === "win32") {
  const real = spawnSync("where", ["jq"], { encoding: "utf8" }).stdout.split(/\r?\n/)[0] ?? "jq";
  const shim = mkdtempSync(join(tmpdir(), "seula-jq-"));
  writeFileSync(join(shim, "jq"), `#!/usr/bin/env bash\nexec "${real.replaceAll("\\", "/")}" -b "$@"\n`);
  process.env.PATH = `${shim}${delimiter}${process.env.PATH ?? ""}`;
}

/** A PATH with `dir` first, in the platform's own form, so a stub in `dir` wins. */
export const pathWith = (dir: string): string => `${dir}${delimiter}${process.env.PATH ?? ""}`;

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
