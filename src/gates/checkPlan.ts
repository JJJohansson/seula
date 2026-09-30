/**
 * G2, first half: script rules on a spec's `## PLAN` section (specs/g2-plan-gate.md criteria
 * 1–5). No model involved. A plan that fails here never reaches Jev. With the spec's base version,
 * the rules look only at the change: the changed criteria and the changed tasks.
 */
import type { SeulaConfig } from "../config.ts";
import { findSection, normalizeHeading, parseSpec, planItems } from "../spec.ts";
import { changedCriteria, changedTasks } from "../specDiff.ts";
import type { Finding } from "./checkSpec.ts";

export interface PlanTask {
  number: string;
  text: string;
  line: number;
  criteria: number[];
  test: string;
  files: string[];
}

/** What the merged change added or changed, for Jev's flags (criterion 6): criteria as "N. text", and tasks. */
export interface PlanChange {
  criteria: string[];
  tasks: PlanTask[];
}

export interface CheckPlanResult {
  ok: boolean;
  findings: Finding[];
  tasks: PlanTask[];
  /** Only with a base version. Without one, all of the spec is the change. */
  change?: PlanChange;
}

const LABEL_END = String.raw`(?=\s(?:Criteria|Test|Files):|$)`;

function label(text: string, name: string): string {
  return (new RegExp(`${name}:\\s*(.*?)${LABEL_END}`).exec(text)?.[1] ?? "").trim().replace(/\.$/, "").trim();
}

/** "1, 2-4" → [1, 2, 3, 4]. A range that runs backwards is reported, and names nothing. */
function criteriaNumbers(list: string, problems: string[]): number[] {
  const numbers: number[] = [];
  for (const token of list.split(",").map((t) => t.trim()).filter(Boolean)) {
    const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(token);
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])];
      if (to < from) problems.push(`the range ${token} runs backwards`);
      else for (let n = from; n <= to; n++) numbers.push(n);
    } else if (/^\d+$/.test(token)) {
      numbers.push(Number(token));
    } else {
      problems.push(`"${token}" is not a criterion number`);
    }
  }
  return numbers;
}

const isUnsafePath = (path: string): boolean =>
  path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path) || path.split(/[\\/]/).includes("..");

/**
 * The spec split at its `## ` headings: [title as written, text], the part before the first heading
 * first. The status block is left out: the status line and the `>` lines directly after it, where
 * `seula approve` may add a line (criterion 5).
 */
function blocks(markdown: string): [string, string][] {
  const out: [string, string][] = [["the title", ""]];
  let inStatus = false;
  for (const line of markdown.split("\n")) {
    if (/^>\s*\*\*Status/.test(line)) inStatus = true;
    else if (!(inStatus && line.startsWith(">"))) inStatus = false;
    if (inStatus) continue;
    if (line.startsWith("## ")) out.push([line.slice(3).trim(), ""]);
    else {
      const last = out[out.length - 1] as [string, string];
      last[1] += `${line.trimEnd()}\n`;
    }
  }
  return out.filter(([title]) => normalizeHeading(title) !== "PLAN").map(([title, text]) => [title, text.trim()]);
}

/** Criterion 5: the first part of the spec, other than `## PLAN` and the status block, that differs. */
function firstDifference(markdown: string, approved: string): string | undefined {
  const now = blocks(markdown);
  const was = blocks(approved);
  for (let i = 0; i < Math.max(now.length, was.length); i++) {
    const [a, b] = [now[i], was[i]];
    if (!a || !b || a[0] !== b[0] || a[1] !== b[1]) return (b ?? a)?.[0];
  }
  return undefined;
}

/**
 * `approved`: the spec as merged (criterion 5). `base`: the spec before the merge (`--base`). With a
 * base version, only changed tasks are checked, and only changed criteria need a task (criteria 1-4).
 */
export function checkPlan(markdown: string, config: SeulaConfig, approved?: string, base?: string): CheckPlanResult {
  const text = markdown.replace(/\r\n?/g, "\n");
  const spec = parseSpec(text, config);
  const findings: Finding[] = [];
  const error = (rule: string, message: string, line?: number) => findings.push({ rule, severity: "error", message, line });
  const newTasks = changedTasks(text, base, config);
  const newCriteria = changedCriteria(spec, base === undefined ? undefined : parseSpec(base, config));

  const section = findSection(spec, "PLAN");
  const tasks: PlanTask[] = [];
  const changed: PlanTask[] = [];
  for (const item of section ? planItems(section.body, section.line) : []) {
    const problems: string[] = [];
    const criteriaText = label(item.text, "Criteria");
    const task: PlanTask = {
      number: item.number,
      text: item.text,
      line: item.line,
      criteria: criteriaNumbers(criteriaText, problems),
      test: label(item.text, "Test"),
      files: label(item.text, "Files").split(",").map((f) => f.trim().replace(/^`|`$/g, "")).filter(Boolean),
    };
    tasks.push(task);
    // An unchanged task planned an earlier change, maybe in free text: it isn't checked (criterion 2).
    if (!newTasks.has(task.number)) continue;
    changed.push(task);
    const missing = [
      ...(task.criteria.length === 0 && problems.length === 0 ? ["Criteria:"] : []),
      ...(task.test === "" ? ["Test:"] : []),
      ...(task.files.length === 0 ? ["Files:"] : []),
    ];
    if (missing.length > 0) error("task", `Plan task ${task.number} has no ${missing.join(", ")}.`, task.line);
    for (const p of problems) error("task", `Plan task ${task.number}: ${p}.`, task.line);
    for (const path of task.files.filter(isUnsafePath)) {
      error("path", `Plan task ${task.number} names the file ${path}: use a path inside the repo, without "..".`, task.line);
    }
  }
  if (tasks.length === 0) {
    error("plan", section ? "The ## PLAN section has no numbered task." : "The spec has no ## PLAN section.", section?.line);
  } else if (changed.length === 0) {
    // Only possible with a base version: every task is from an earlier change (criterion 1).
    error("plan", "No plan task is new or changed. Add a task for this change, for example a test for a new edge case.", section?.line);
  } else {
    const known = new Set(spec.criteria.map((c) => c.number));
    // Only a changed task covers a changed criterion: an old task planned the old text (criterion 3).
    const covered = new Set(changed.flatMap((t) => t.criteria.map(String)));
    for (const c of spec.criteria.filter((c) => newCriteria.has(c.number))) {
      if (!covered.has(c.number)) error("coverage", `No plan task covers criterion ${c.number}.`, c.line);
    }
    for (const t of changed) {
      for (const n of t.criteria.filter((n) => !known.has(String(n)))) {
        error("coverage", `Plan task ${t.number} names criterion ${n}, which the spec doesn't have.`, t.line);
      }
    }
  }

  if (approved !== undefined) {
    const differs = firstDifference(text, approved.replace(/\r\n?/g, "\n"));
    if (differs) error("approved", `The spec differs from the approved spec in "${differs}". Only ## PLAN and the status block may change.`);
  }

  const change = base === undefined ? undefined : { criteria: spec.criteria.filter((c) => newCriteria.has(c.number)).map((c) => `${c.number}. ${c.text}`), tasks: changed };
  return { ok: findings.length === 0, findings, tasks, change };
}
