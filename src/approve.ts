/**
 * `seula approve` (specs/spec-to-plan-workflow.md criterion 15): merging a spec pull request is
 * its approval, and the plan step records it in the spec's status line. Nothing else changes.
 */
import type { SeulaConfig } from "./config.ts";
import { UsageError } from "./errors.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS_LINE = /^>\s*\*\*Status.*$/m;

/** "28 Sep 2026", the date style of the specs' status lines. */
export function specDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function approveSpec(markdown: string, config: SeulaConfig, pr: number, today: Date = new Date()): string {
  if (!Number.isSafeInteger(pr) || pr < 1) throw new UsageError(`--pr must be a pull request number, not "${pr}".`);
  if (!config.statuses.includes("Approved")) {
    throw new UsageError(`"Approved" is not one of the config's statuses (${config.statuses.join(", ")}).`);
  }
  const m = STATUS_LINE.exec(markdown);
  if (!m) throw new UsageError("The spec has no status line (> **Status:** …).");
  // Keep a CRLF file CRLF: the match stops before "\n", so a trailing "\r" belongs to the line.
  const cr = m[0].endsWith("\r") ? "\r" : "";
  const line = `> **Status:** Approved (${specDate(today)}, merged in #${pr})${cr}`;
  return markdown.slice(0, m.index) + line + markdown.slice(m.index + m[0].length);
}
