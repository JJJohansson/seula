/** Parses a markdown feature spec into the parts the gates need. */

export interface Section {
  /** Heading text as written, without the leading "## ". */
  title: string;
  /** Uppercased, "(...)" qualifiers removed, whitespace collapsed. */
  normalized: string;
  body: string;
  /** 1-based line number of the heading. */
  line: number;
}

export interface Criterion {
  /** As written: "3", or "6b" for an inserted criterion. */
  number: string;
  text: string;
  line: number;
}

export interface ParsedSpec {
  title?: string;
  titleLine?: number;
  /** The configured status word found on the Status line, e.g. "Idea". */
  status?: string;
  /** Everything after "Status:" on that line, markdown stripped. */
  statusText?: string;
  statusLine?: number;
  sections: Section[];
  criteriaSection?: Section;
  criteria: Criterion[];
  /** Source lines with fenced code blocks blanked out, for text checks. */
  proseLines: string[];
}

export function normalizeHeading(title: string): string {
  return title
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** "EDGE CASES / RISKS" and "OUT OF SCOPE (v1)" both satisfy a required "EDGE CASES" / "OUT OF SCOPE". */
export function headingMatches(sectionTitle: string, required: string): boolean {
  return normalizeHeading(sectionTitle).startsWith(normalizeHeading(required));
}

export function findSection(spec: ParsedSpec, required: string): Section | undefined {
  return spec.sections.find((s) => headingMatches(s.title, required));
}

const ITEM = /^(\d+[a-z]?)\.\s+(.*)$/;

export function parseSpec(markdown: string, opts: { statuses: string[]; criteriaSection: string }): ParsedSpec {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const proseLines = blankFencedCode(lines);
  const spec: ParsedSpec = { sections: [], criteria: [], proseLines };

  for (let i = 0; i < proseLines.length; i++) {
    const line = proseLines[i] ?? "";
    if (spec.title === undefined && /^#\s+\S/.test(line)) {
      spec.title = line.replace(/^#\s+/, "").trim();
      spec.titleLine = i + 1;
    }
    if (spec.statusLine === undefined && /^>\s*.*\bStatus\s*:/i.test(line)) {
      const after = line.replace(/^>\s*/, "").replace(/^.*?\bStatus\s*:/i, "");
      const text = after.replace(/[*_`]/g, "").trim();
      spec.statusText = text;
      spec.statusLine = i + 1;
      spec.status = firstStatusWord(text, opts.statuses);
    }
  }

  // Level-2 sections run until the next level-2 heading or a horizontal rule.
  let current: { title: string; line: number; body: string[] } | undefined;
  const flush = () => {
    if (!current) return;
    spec.sections.push({
      title: current.title,
      normalized: normalizeHeading(current.title),
      body: current.body.join("\n"),
      line: current.line,
    });
    current = undefined;
  };
  proseLines.forEach((line, i) => {
    if (/^##\s+\S/.test(line) && !/^###/.test(line)) {
      flush();
      current = { title: line.replace(/^##\s+/, "").trim(), line: i + 1, body: [] };
    } else if (/^(---|\*\*\*|___)\s*$/.test(line)) {
      flush();
    } else if (current) {
      current.body.push(line);
    }
  });
  flush();

  spec.criteriaSection = findSection(spec, opts.criteriaSection);
  if (spec.criteriaSection) spec.criteria = parseCriteria(spec.criteriaSection);
  return spec;
}

function firstStatusWord(text: string, statuses: string[]): string | undefined {
  let best: { word: string; at: number } | undefined;
  for (const word of statuses) {
    const m = new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").exec(text);
    if (m && (best === undefined || m.index < best.at)) best = { word, at: m.index };
  }
  return best?.word;
}

function parseCriteria(section: Section): Criterion[] {
  const out: Criterion[] = [];
  let item: Criterion | undefined;
  let blankSeen = false;
  const bodyLines = section.body.split("\n");
  bodyLines.forEach((raw, idx) => {
    const lineNo = section.line + 1 + idx;
    const m = ITEM.exec(raw);
    if (m) {
      item = { number: m[1] ?? "", text: (m[2] ?? "").trim(), line: lineNo };
      out.push(item);
      blankSeen = false;
      return;
    }
    if (raw.trim() === "") {
      blankSeen = true;
      return;
    }
    if (/^#{3,}\s/.test(raw)) {
      item = undefined; // a sub-heading ends the current item; later items still count
      return;
    }
    const indented = /^\s{2,}\S/.test(raw);
    if (item && (indented || !blankSeen)) {
      item.text = `${item.text} ${raw.trim()}`.trim();
    } else {
      item = undefined; // an unindented paragraph after a blank line is a note, not criterion text
    }
    blankSeen = false;
  });
  return out;
}

const PLAN_ITEM = /^(\d+)[.)]\s+(.*)$/;

/** The numbered items of a `## PLAN` section's body, each with its wrapped lines joined into one line (specs/g2-plan-gate.md). */
export function planItems(body: string, firstLine: number): { number: string; text: string; line: number }[] {
  const lines = body.split("\n");
  const items: { number: string; text: string; line: number }[] = [];
  let current: { number: string; text: string; line: number } | undefined;
  for (const [i, raw] of lines.entries()) {
    const m = PLAN_ITEM.exec(raw);
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

/** Replace the contents of ``` fenced blocks with empty lines, keeping line numbers stable. */
function blankFencedCode(lines: string[]): string[] {
  let inFence = false;
  return lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return "";
    }
    return inFence ? "" : line;
  });
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
