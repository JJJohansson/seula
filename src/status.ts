/** `seula status`: one line per run file, with who acts next (specs/run-files.md criteria 8-9). */
import { type EventResult, GATES, type RunFile } from "./runs.ts";

const SYMBOL: Record<EventResult, string> = { pass: "✓", back: "↺", review: "?", fail: "✗", skipped: "–" };

/** "G0 ✓  G1 ↺✓" — each gate's history in order. */
export function gateTrail(run: RunFile): string {
  return GATES.map((g) => {
    const events = run.events.filter((e) => e.gate === g);
    return events.length ? `${g} ${events.map((e) => SYMBOL[e.result]).join("")}` : "";
  })
    .filter(Boolean)
    .join("  ");
}

/** The next action. When a person is next, the last event says which decision is theirs (criterion 9). */
export function waitingLabel(run: RunFile): string {
  if (run.waitingOn === "none") return "done";
  if (run.waitingOn === "agent") return "→ agent";
  if (run.blocked) return "→ you: loop limit reached";
  const last = run.events.at(-1);
  if (last?.gate === "G0" && last.result === "back") return "→ you: answer the ticket questions";
  if (last?.gate === "G1" && last.result === "pass") return "→ you: review and merge the spec";
  if (last?.gate === "G4" && last.result === "pass") return "→ you: merge";
  return "→ you: review";
}

/** The table, under a line that counts the runs waiting on a person. `readRuns` sorts them newest first. */
export function statusTable(runs: RunFile[]): string {
  if (runs.length === 0) return "No runs yet. Gates write to the runs directory when given --run <id>.";
  const waiting = runs.filter((r) => r.waitingOn === "human").length;
  const rows = runs.map((r) => [r.id, truncate(r.title ?? "", 28), r.step, gateTrail(r), waitingLabel(r)]);
  const header = ["FEATURE", "TITLE", "STEP", "GATES", "NEXT"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => (row[i] ?? "").length)));
  const fmt = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  return [`Waiting on you: ${waiting}`, "", fmt(header), ...rows.map(fmt)].join("\n");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
