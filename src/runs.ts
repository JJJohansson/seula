/**
 * One run file per feature: .seula/runs/<id>.json. Every gate appends an event.
 * It travels with the feature branch, so the gate history is reviewed with the change.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type GateId = "G0" | "G1" | "G2" | "G3" | "G4" | "G5";
export type EventResult = "pass" | "back" | "review" | "fail" | "skipped";
export type WaitingOn = "agent" | "human" | "none";

export interface GateEvent {
  gate: GateId;
  result: EventResult;
  at: string;
  attempt: number;
  summary?: string;
  /** Short, human-readable reasons, e.g. "criterion 2 · unambiguous: 0.18 → back". */
  feedback?: string[];
  costUsd?: number;
}

export interface RunFile {
  id: string;
  title?: string;
  spec?: string;
  step: string;
  waitingOn: WaitingOn;
  /** Set when a gate has sent the feature back more than `maxBacks` times. A person must step in. */
  blocked?: string;
  events: GateEvent[];
  links: { ticket?: string; pr?: string; design?: string };
  cost: { claudeUsd: number; jevUsd: number };
  updatedAt: string;
}

/** Where a feature goes after each gate passes. */
const AFTER_PASS: Record<GateId, { step: string; waitingOn: WaitingOn }> = {
  G0: { step: "spec", waitingOn: "agent" },
  G1: { step: "spec review", waitingOn: "human" }, // you approve the spec
  G2: { step: "build", waitingOn: "agent" },
  G3: { step: "verify", waitingOn: "agent" },
  G4: { step: "merge", waitingOn: "human" }, // you merge
  G5: { step: "done", waitingOn: "none" },
};

const STEP_OF: Record<GateId, string> = {
  G0: "input",
  G1: "spec",
  G2: "plan",
  G3: "build",
  G4: "verify",
  G5: "deploy",
};

export const GATES: GateId[] = ["G0", "G1", "G2", "G3", "G4", "G5"];

export function isGateId(s: string): s is GateId {
  return (GATES as string[]).includes(s);
}

export function runPath(runsDir: string, id: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`Invalid run id "${id}": use letters, digits, '.', '_' or '-'.`);
  return join(runsDir, `${id}.json`);
}

export function readRun(runsDir: string, id: string): RunFile | undefined {
  const path = runPath(runsDir, id);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as RunFile) : undefined;
}

export interface AppendOptions {
  title?: string;
  spec?: string;
  links?: RunFile["links"];
  claudeUsd?: number;
  /** After this many backs from one gate, the next back blocks the feature. */
  maxBacks?: number;
  now?: Date;
}

export function appendEvent(
  runsDir: string,
  id: string,
  event: Omit<GateEvent, "at" | "attempt">,
  opts: AppendOptions = {},
): RunFile {
  const now = (opts.now ?? new Date()).toISOString();
  const run: RunFile = readRun(runsDir, id) ?? {
    id,
    step: "input",
    waitingOn: "agent",
    events: [],
    links: {},
    cost: { claudeUsd: 0, jevUsd: 0 },
    updatedAt: now,
  };
  if (opts.title) run.title = opts.title;
  if (opts.spec) run.spec = opts.spec;
  if (opts.links) run.links = { ...run.links, ...opts.links };
  if (opts.claudeUsd) run.cost.claudeUsd += opts.claudeUsd;
  if (event.costUsd) run.cost.jevUsd += event.costUsd;

  const attempt = run.events.filter((e) => e.gate === event.gate).length + 1;
  run.events.push({ ...event, at: now, attempt });

  if (event.result === "pass" || event.result === "skipped") {
    Object.assign(run, AFTER_PASS[event.gate]);
    delete run.blocked;
  } else {
    run.step = STEP_OF[event.gate];
    // G0 sends questions to the ticket author, so a person answers; other backs go to the agent.
    run.waitingOn = event.result === "back" && event.gate !== "G0" ? "agent" : "human";
    if (event.result === "back" && opts.maxBacks !== undefined && backCount(run, event.gate) > opts.maxBacks) {
      run.waitingOn = "human";
      run.blocked = `${event.gate} sent this back ${backCount(run, event.gate)} times (limit ${opts.maxBacks}).`;
    }
  }
  run.updatedAt = now;

  mkdirSync(runsDir, { recursive: true });
  writeFileSync(runPath(runsDir, id), `${JSON.stringify(run, null, 2)}\n`);
  return run;
}

/** Add links or Claude cost to a run without recording a gate event. */
export function updateRun(
  runsDir: string,
  id: string,
  patch: { links?: RunFile["links"]; claudeUsd?: number; title?: string },
  now: Date = new Date(),
): RunFile {
  const run = readRun(runsDir, id);
  if (!run) throw new Error(`No run file for "${id}" in ${runsDir}.`);
  if (patch.links) run.links = { ...run.links, ...patch.links };
  if (patch.claudeUsd) run.cost.claudeUsd += patch.claudeUsd;
  if (patch.title) run.title = patch.title;
  run.updatedAt = now.toISOString();
  writeFileSync(runPath(runsDir, id), `${JSON.stringify(run, null, 2)}\n`);
  return run;
}

export function readRuns(runsDir: string): RunFile[] {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(runsDir, f), "utf8")) as RunFile)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** How many times a gate has sent this feature back. Used to stop loops. */
export function backCount(run: RunFile | undefined, gate: GateId): number {
  return run?.events.filter((e) => e.gate === gate && e.result === "back").length ?? 0;
}
