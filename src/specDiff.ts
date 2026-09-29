/**
 * The ticket's part of a spec: what changed compared with the spec's base version (specs/g1-spec-gate.md,
 * DATA SCHEMA; specs/g2-plan-gate.md, DATA SCHEMA). G1 and G2 check only that part when they get
 * `--base`. Without a base version the spec is new, and all of it counts as changed.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SeulaConfig } from "./config.ts";
import { UsageError } from "./errors.ts";
import { type ParsedSpec, findSection, parseSpec, planItems } from "./spec.ts";

/** Whitespace doesn't count: a re-wrapped or re-indented line is the same line. */
const same = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The numbers of the changed criteria, as written: a number the base version doesn't have, or other text. */
export function changedCriteria(spec: ParsedSpec, base: ParsedSpec | undefined): Set<string> {
  if (!base) return new Set(spec.criteria.map((c) => c.number));
  const was = new Map(base.criteria.map((c) => [c.number, same(c.text)]));
  return new Set(spec.criteria.filter((c) => was.get(c.number) !== same(c.text)).map((c) => c.number));
}

/** Whether a line is in the base version, with whitespace ignored (g1 criterion 20). Without a base version, no line is. */
export function unchangedLine(base: string | undefined): (line: string) => boolean {
  if (base === undefined) return () => false;
  const lines = new Set(base.split(/\r\n?|\n/).map(same).filter(Boolean));
  return (line) => {
    const text = same(line);
    return text !== "" && lines.has(text);
  };
}

/** The numbers of the plan tasks whose text is not in the base version's `## PLAN`. Tasks match by text, so renumbering changes nothing. */
export function changedTasks(markdown: string, base: string | undefined, config: SeulaConfig): Set<string> {
  const now = planTexts(markdown, config);
  const was = new Set(base === undefined ? [] : planTexts(base, config).map((t) => t.text));
  return new Set(now.filter((t) => !was.has(t.text)).map((t) => t.number));
}

function planTexts(markdown: string, config: SeulaConfig): { number: string; text: string }[] {
  const section = findSection(parseSpec(markdown, config), "PLAN");
  return section ? planItems(section.body, section.line).map((item) => ({ number: item.number, text: same(item.text) })) : [];
}

/**
 * The spec's base version from the base folder, at the spec's path from the repo root (`cwd`), or
 * nothing for a new spec. A spec outside the repo has no path in the base folder (g1 edge cases).
 */
export function readBaseVersion(baseDir: string, specFile: string, cwd: string = process.cwd()): string | undefined {
  const root = resolve(cwd);
  const path = relative(root, resolve(root, specFile));
  if (path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new UsageError(`With --base, the spec must be inside the repo: ${specFile}`);
  }
  const file = join(resolve(root, baseDir), path);
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}
