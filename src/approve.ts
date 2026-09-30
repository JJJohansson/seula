/**
 * `seula approve` (specs/spec-to-plan-workflow.md criterion 15): merging a spec pull request is
 * its approval, and the plan step records it in the spec's status block. Nothing else changes.
 */
import type { SeulaConfig } from "./config.ts";
import { UsageError } from "./errors.ts";
import { escapeRegExp, parseSpec } from "./spec.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS_LINE = /^>\s*\*\*Status/;

/** "28 Sep 2026", the date style of the specs' status lines. */
export function specDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * A spec that isn't buildable yet (an Idea) becomes Approved: only its status marker, and a `(…)`
 * right after it, is replaced. A buildable spec (Active, Shipped, Approved) keeps its status, and
 * gets a "Change approved" line at the end of the status block's first paragraph.
 */
export function approveSpec(markdown: string, config: SeulaConfig, pr: number, today: Date = new Date()): string {
  if (!Number.isSafeInteger(pr) || pr < 1) throw new UsageError(`--pr must be a pull request number, not "${pr}".`);
  if (!config.statuses.includes("Approved")) {
    throw new UsageError(`"Approved" is not one of the config's statuses (${config.statuses.join(", ")}).`);
  }
  // Split after each line end, so every line keeps its own "\n" or "\r\n".
  const lines = markdown.split(/(?<=\n)/);
  const at = lines.findIndex((l) => STATUS_LINE.test(l));
  if (at < 0) throw new UsageError("The spec has no status line (> **Status:** …).");
  const approval = `(${specDate(today)}, merged in #${pr})`;
  const status = parseSpec(markdown, config).status;

  if (status === undefined || !config.buildableStatuses.includes(status)) {
    const line = lines[at] ?? "";
    const word = escapeRegExp(status ?? "");
    // `**Status:** Idea (27 Sep 2026).` or `**Status: Idea.**`: the marker with its "(…)" and period.
    const marker = new RegExp(String.raw`\*\*Status:\*\*\s*${word}(?:\s*\([^)]*\))?\.?|\*\*Status:\s*${word}(?:\s*\([^)]*\))?\.?\*\*\.?`, "i");
    const eol = /\r?\n$/.exec(line)?.[0] ?? "";
    // Without a known status word there is no marker to find; the whole line is replaced.
    lines[at] = status !== undefined && marker.test(line) ? line.replace(marker, `**Status:** Approved ${approval}.`) : `> **Status:** Approved ${approval}.${eol}`;
    return lines.join("");
  }

  // The first paragraph of the status block ends at a `>` line with nothing else, or at the block's end.
  let end = at;
  while (end + 1 < lines.length && /^>/.test(lines[end + 1] ?? "") && !/^>\s*$/.test(lines[end + 1] ?? "")) end++;
  const eol = /\r\n$/.test(lines[at] ?? "") ? "\r\n" : "\n";
  if (!(lines[end] ?? "").endsWith("\n")) lines[end] += eol;
  lines.splice(end + 1, 0, `> Change approved ${approval}.${eol}`);
  return lines.join("");
}
