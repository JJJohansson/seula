/**
 * G1, first half: deterministic format rules for a spec. No model involved.
 * A spec that fails here never reaches Jev. With a base version, the line rules look only at
 * the ticket's change (specs/g1-spec-gate.md criterion 20).
 */
import type { SeulaConfig } from "../config.ts";
import { type ParsedSpec, findSection, normalizeHeading, parseSpec } from "../spec.ts";
import { changedCriteria, unchangedLine } from "../specDiff.ts";

export type Severity = "error" | "warn" | "info";

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  line?: number;
}

export interface CheckSpecResult {
  ok: boolean;
  findings: Finding[];
}

/** `base`: the spec's base version (`--base`). Without it, the spec is new and every rule covers all of it. */
export function checkSpec(spec: ParsedSpec, config: SeulaConfig, opts: { base?: string } = {}): CheckSpecResult {
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  const changed = changedCriteria(spec, opts.base === undefined ? undefined : parseSpec(opts.base, config));
  const inBase = unchangedLine(opts.base);

  if (!spec.title) add({ rule: "title", severity: "error", message: "No '# ' title line." });

  if (spec.statusLine === undefined) {
    add({ rule: "status", severity: "error", message: "No '> **Status:** …' line." });
  } else if (!spec.status) {
    add({
      rule: "status",
      severity: "error",
      message: `Status "${spec.statusText}" is not one of: ${config.statuses.join(", ")}.`,
      line: spec.statusLine,
    });
  } else if (!config.buildableStatuses.includes(spec.status)) {
    add({
      rule: "status",
      severity: "info",
      message: `Status is ${spec.status}: not buildable until approved.`,
      line: spec.statusLine,
    });
  }

  for (const required of config.requiredSections) {
    if (!findSection(spec, required)) {
      add({ rule: "section", severity: "error", message: `Missing section "## ${required}".` });
    }
  }

  const cs = spec.criteriaSection;
  if (cs && spec.criteria.length === 0) {
    add({
      rule: "criteria",
      severity: "error",
      message: `"## ${cs.title}" has no numbered criteria ("1. …").`,
      line: cs.line,
    });
  }

  // Numbering: code and tests cite criteria by number, so a duplicate number is an error.
  // Order doesn't matter (criteria are often grouped by topic); a gap is only a warning.
  const seen = new Map<string, number>();
  for (const c of spec.criteria) {
    const prev = seen.get(c.number);
    if (prev !== undefined) {
      add({
        rule: "numbering",
        severity: "error",
        message: `Criterion ${c.number} is numbered twice (also line ${prev}), so citations to it are ambiguous.`,
        line: c.line,
      });
    }
    seen.set(c.number, c.line);
    if (changed.has(c.number) && c.text.split(/\s+/).filter(Boolean).length < 3) {
      add({ rule: "criterion-text", severity: "error", message: `Criterion ${c.number} is too short to test.`, line: c.line });
    }
  }
  const bases = spec.criteria.map((c) => Number.parseInt(c.number, 10)).filter((n) => !Number.isNaN(n));
  if (bases.length) {
    const missing: number[] = [];
    for (let n = 1; n <= Math.max(...bases); n++) if (!bases.includes(n)) missing.push(n);
    if (missing.length) {
      add({
        rule: "numbering",
        severity: "warn",
        message: `No criterion numbered ${missing.join(", ")}. Fine if removed on purpose; otherwise renumber.`,
        line: cs?.line,
      });
    }
  }

  // Draft criteria can't back a buildable status.
  if (cs && /\bDRAFT\b/i.test(cs.title) && spec.status && config.buildableStatuses.includes(spec.status)) {
    add({
      rule: "draft",
      severity: "error",
      message: `Criteria are marked DRAFT but the status is ${spec.status}. Confirm them or change the status.`,
      line: cs.line,
    });
  }

  // Placeholders and template leftovers, outside code blocks and inline code. One in a line that
  // the base version already has is the earlier author's, not the ticket's: a warning only.
  const patterns = config.placeholderPatterns.map((p) => new RegExp(p, "i"));
  const templateSlot = /<[^<>\n]*\s[^<>\n]*>/; // "<1–3 sentences: …>"; not "<Button>"
  spec.proseLines.forEach((raw, i) => {
    const line = raw.replace(/`[^`]*`/g, "");
    const old = inBase(raw);
    const severity: Severity = old ? "warn" : "error";
    const already = old ? ", already in the base version" : "";
    if (patterns.some((re) => re.test(line))) {
      add({ rule: "placeholder", severity, message: `Unfinished text${already}: "${line.trim()}"`, line: i + 1 });
    } else if (templateSlot.test(line) && !/^\s*<!--/.test(line)) {
      add({ rule: "placeholder", severity, message: `Template slot not filled in${already}: "${line.trim()}"`, line: i + 1 });
    }
  });

  // Empty required sections.
  for (const s of spec.sections) {
    const isRequired = config.requiredSections.some((r) => normalizeHeading(s.title).startsWith(normalizeHeading(r)));
    if (isRequired && s.body.trim() === "") {
      add({ rule: "section", severity: "error", message: `Section "## ${s.title}" is empty.`, line: s.line });
    }
  }

  return { ok: !findings.some((f) => f.severity === "error"), findings };
}
