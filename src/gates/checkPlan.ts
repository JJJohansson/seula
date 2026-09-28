/**
 * G2, first half: script rules on a spec's `## PLAN` section (specs/g2-plan-gate.md criteria
 * 1–5). No model involved. A plan that fails here never reaches Jev.
 */
import type { SeulaConfig } from "../config.ts";
import { findSection, normalizeHeading, parseSpec } from "../spec.ts";
import type { Finding } from "./checkSpec.ts";

export interface PlanTask {
  number: string;
  text: string;
  line: number;
  criteria: number[];
  test: string;
  files: string[];
}

export interface CheckPlanResult {
  ok: boolean;
  findings: Finding[];
  tasks: PlanTask[];
}

const ITEM = /^(\d+)[.)]\s+(.*)$/;
const LABEL_END = String.raw`(?=\s(?:Criteria|Test|Files):|$)`;

/** The numbered items of the plan, each with its wrapped lines joined into one line. */
function planItems(body: string, firstLine: number): { number: string; text: string; line: number }[] {
  const lines = body.split("\n");
  const items: { number: string; text: string; line: number }[] = [];
  let current: { number: string; text: string; line: number } | undefined;
  for (const [i, raw] of lines.entries()) {
    const m = ITEM.exec(raw);
    if (m) {
      current = { number: m[1] ?? "", text: m[2] ?? "", line: firstLine + 1 + i };
      items.push(current);
    } else if (current && raw.trim() !== "" && !raw.startsWith("#") && (/^\s/.test(raw) || lines[i - 1]?.trim() !== "")) {
      current.text += ` ${raw.trim()}`;
    } else {
      current = undefined;
    }
  }
  return items;
}

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

/** The spec split at its `## ` headings: [title as written, text], the part before the first heading first. */
function blocks(markdown: string): [string, string][] {
  const out: [string, string][] = [["the title", ""]];
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) out.push([line.slice(3).trim(), ""]);
    else if (!/^>\s*\*\*Status/.test(line)) {
      const last = out[out.length - 1] as [string, string];
      last[1] += `${line.trimEnd()}\n`;
    }
  }
  return out.filter(([title]) => normalizeHeading(title) !== "PLAN").map(([title, text]) => [title, text.trim()]);
}

/** Criterion 5: the first part of the spec, other than `## PLAN` and the status line, that differs. */
function firstDifference(markdown: string, approved: string): string | undefined {
  const now = blocks(markdown);
  const was = blocks(approved);
  for (let i = 0; i < Math.max(now.length, was.length); i++) {
    const [a, b] = [now[i], was[i]];
    if (!a || !b || a[0] !== b[0] || a[1] !== b[1]) return (b ?? a)?.[0];
  }
  return undefined;
}

export function checkPlan(markdown: string, config: SeulaConfig, approved?: string): CheckPlanResult {
  const text = markdown.replace(/\r\n?/g, "\n");
  const spec = parseSpec(text, config);
  const findings: Finding[] = [];
  const error = (rule: string, message: string, line?: number) => findings.push({ rule, severity: "error", message, line });

  const section = findSection(spec, "PLAN");
  const tasks: PlanTask[] = [];
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
  } else {
    const known = new Set(spec.criteria.map((c) => c.number));
    const covered = new Set(tasks.flatMap((t) => t.criteria.map(String)));
    for (const c of spec.criteria) {
      if (!covered.has(c.number)) error("coverage", `No plan task covers criterion ${c.number}.`, c.line);
    }
    for (const t of tasks) {
      for (const n of t.criteria.filter((n) => !known.has(String(n)))) {
        error("coverage", `Plan task ${t.number} names criterion ${n}, which the spec doesn't have.`, t.line);
      }
    }
  }

  if (approved !== undefined) {
    const differs = firstDifference(text, approved.replace(/\r\n?/g, "\n"));
    if (differs) error("approved", `The spec differs from the approved spec in "${differs}". Only ## PLAN and the status line may change.`);
  }

  return { ok: findings.length === 0, findings, tasks };
}
