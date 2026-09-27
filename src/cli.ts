#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { parseArgs } from "node:util";
import { calibrate, calibrationReport, type LabelsFile } from "./calibrate.ts";
import { type SeulaConfig, type TrackerState, type TrackerType, loadConfig } from "./config.ts";
import { CredentialError } from "./errors.ts";
import { type CheckSpecResult, checkSpec } from "./gates/checkSpec.ts";
import { type JevSpecResult, feedbackLines, jevSpec } from "./gates/jevSpec.ts";
import { type JevTicketResult, jevTicket, wordCount } from "./gates/jevTicket.ts";
import { type DecisionModel, JevHttpModel, RecordedModel, RecordingModel } from "./jev/model.ts";
import type { Decision } from "./routing.ts";
import { type ClaudeRun, type EventResult, type GateId, type RunFile, appendEvent, claudeRunFromOutput, readRun, readRuns, updateRun } from "./runs.ts";
import { type ParsedSpec, parseSpec } from "./spec.ts";
import { init, initReport } from "./init.ts";
import { renderSpecWriterPrompt } from "./prompts.ts";
import { statusTable } from "./status.ts";
import { appendComments } from "./trackers/comments.ts";
import { makeTracker } from "./trackers/index.ts";
import { TicketError, ticketMarkdown } from "./trackers/types.ts";

const HELP = `seula: spec-driven quality gates for AI coding agents

Usage:
  seula gate g0 --ticket <file>  G0: is the ticket ready to write a spec from?
  seula gate g1 <spec.md>        G1: format rules, then Jev on each criterion
  seula check-spec <spec.md>…    G1 format rules only (no model); several specs allowed
  seula jev-spec <spec.md>       G1 Jev questions only
  seula status                   Where each feature is, gate by gate
  seula update --run <id>        Add --claude-usd <n> or --claude-result <file>, --ticket-url <url> or --pr-url <url> to a run
  seula calibrate <labels.json>  Pick Jev cut-offs from labeled examples

  seula init --tracker <jira|github>   Set seula up in this repo (config + workflows)
  seula tracker ticket --event <file> --out <file>        Ticket file from a trigger event
  seula tracker comments --key <key> --append <file>      Add the ticket's comments to a ticket file
  seula tracker comment --key <key> --text-file <file>    Comment on a ticket
  seula tracker move --key <key> --state <needsInput|specReview>
  seula prompt spec-writer --run <id> --ticket <file>     The spec-writer prompt for a run
                                 (--previous-spec <file>: an earlier run's draft to update)
  seula config                   The effective configuration, as JSON

Options:
  --run <id>          Record the result in the feature's run file (e.g. --run WEB-42)
  --title <text>      Feature title for the run file (G0; G1 reads it from the spec)
  --ticket <file>     Ticket text. Required for G0; optional context for G1
  --recorded <file>   Use recorded Jev answers instead of calling the API
  --record <file>     Call the API and save the answers for later --recorded runs
  --config <file>     Config file (default: seula.config.json)
  --json              Machine-readable output
  --tracker <type>    jira or github (default: tracker.type in the config)
  init: --spec-dir <dir>  --design-first  --seula-ref <ref>  --force

Environment:
  TYPESAFE_API_KEY    Jev API key. Read from the environment or a .env file here.
                      Without it (and without --recorded), Jev checks are skipped.
  JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN      Jira tracker
  GITHUB_TOKEN, GITHUB_REPOSITORY                GitHub tracker

Exit codes:
  0 pass or skipped · 1 back: rework and run again · 2 unsure: a reviewer or person decides
  3 stop: the loop limit is reached, a person must step in · 64 usage error
  70 internal error (for example the Jev API failed): nothing was decided
  77 a service refused a credential (HTTP 401 or 403): the message names it
`;

const EXIT: Record<Decision | "skipped", number> = { pass: 0, skipped: 0, back: 1, review: 2 };
const EXIT_BLOCKED = 3;
const EXIT_ERROR = 70;
const EXIT_CREDENTIAL = 77;

interface Options {
  run?: string;
  title?: string;
  "claude-usd"?: string;
  "claude-result"?: string;
  "ticket-url"?: string;
  "pr-url"?: string;
  ticket?: string;
  recorded?: string;
  record?: string;
  config?: string;
  json: boolean;
  tracker?: string;
  event?: string;
  out?: string;
  key?: string;
  state?: string;
  "text-file"?: string;
  append?: string;
  "seula-cmd"?: string;
  "previous-spec"?: string;
  "spec-dir"?: string;
  "design-first"?: boolean;
  "seula-ref"?: string;
  force?: boolean;
}

async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (values.help || !command || command === "help") {
    process.stdout.write(HELP);
    return command || values.help ? 0 : 64;
  }

  loadDotEnv();
  const opts: Options = values;
  const config = loadConfig(process.cwd(), opts.config);
  const out = (text: string, data: unknown) => process.stdout.write(opts.json ? `${JSON.stringify(data, null, 2)}\n` : `${text}\n`);

  switch (command) {
    case "check-spec": {
      need(rest[0], "check-spec <spec.md> [more specs…]");
      if (opts.run && rest.length > 1) throw new UsageError("--run takes a single spec.");
      const ignored = new Set(config.ignore.map((p) => p.replaceAll("\\", "/")));
      const files = rest.filter((f) => !ignored.has(relative(process.cwd(), f).replaceAll("\\", "/")));
      const skipped = rest.length - files.length;
      if (files.length === 0) {
        out(`All ${skipped} file(s) are in the config's ignore list; nothing to check.`, []);
        return EXIT.pass;
      }
      let blocked = false;
      const results = files.map((file) => {
        const spec = readSpec(file, config);
        const result = checkSpec(spec, config);
        const run = recordSpec(opts, config, "G1", spec, file, result.ok ? "pass" : "back", formatFindingsSummary(result), findingLines(result));
        blocked ||= Boolean(run?.blocked);
        return { file, result };
      });
      const failed = results.filter((r) => !r.result.ok).length;
      const summary =
        (results.length > 1 ? `\n${results.length - failed} of ${results.length} specs pass.` : "") +
        (skipped ? `\n${skipped} file(s) skipped: in the config's ignore list.` : "");
      out(results.map((r) => formatCheck(r.file, r.result)).join("\n\n") + summary, results.length > 1 ? results : results[0]?.result);
      return blocked ? EXIT_BLOCKED : EXIT[failed ? "back" : "pass"];
    }

    case "jev-spec": {
      const file = need(rest[0], "jev-spec <spec.md>");
      const spec = readSpec(file, config);
      const model = pickModel(opts, config);
      if (!model) {
        out(skippedText("G1"), { decision: "skipped" });
        recordSpec(opts, config, "G1", spec, file, "skipped", "Jev skipped: no TYPESAFE_API_KEY");
        return EXIT.skipped;
      }
      const result = await jevSpec(spec, config, model, { ticket: readTicket(opts.ticket) });
      const run = recordSpec(opts, config, "G1", spec, file, result.decision, jevSummary(result), feedbackLines(result), result.costUsd);
      out(formatJev(file, result) + blockedText(run), { ...result, blocked: run?.blocked });
      return run?.blocked ? EXIT_BLOCKED : EXIT[result.decision];
    }

    case "gate": {
      const gate = (rest[0] ?? "").toUpperCase();
      if (gate === "G0") return gateG0(opts, config, out);
      if (gate !== "G1") throw new UsageError(`Unknown gate "${rest[0] ?? ""}". Available: g0, g1.`);
      const file = need(rest[1], "gate g1 <spec.md>");
      const spec = readSpec(file, config);
      const check = checkSpec(spec, config);
      if (!check.ok) {
        const run = recordSpec(opts, config, "G1", spec, file, "back", formatFindingsSummary(check), findingLines(check));
        out(formatCheck(file, check) + blockedText(run), { decision: "back", check, blocked: run?.blocked });
        return run?.blocked ? EXIT_BLOCKED : EXIT.back;
      }
      const model = pickModel(opts, config);
      if (!model) {
        recordSpec(opts, config, "G1", spec, file, "skipped", "Format passed; Jev skipped: no TYPESAFE_API_KEY");
        out(`${formatCheck(file, check)}\n\n${skippedText("G1")}`, { decision: "skipped", check });
        return EXIT.skipped;
      }
      const jev = await jevSpec(spec, config, model, { ticket: readTicket(opts.ticket) });
      const run = recordSpec(opts, config, "G1", spec, file, jev.decision, jevSummary(jev), feedbackLines(jev), jev.costUsd);
      out(`${formatCheck(file, check)}\n\n${formatJev(file, jev)}${blockedText(run)}`, { decision: jev.decision, check, jev, blocked: run?.blocked });
      return run?.blocked ? EXIT_BLOCKED : EXIT[jev.decision];
    }

    case "status": {
      const runs = readRuns(config.runsDir);
      out(statusTable(runs), runs);
      return 0;
    }

    case "update": {
      const id = need(opts.run, "update --run <id> [--claude-usd <n> | --claude-result <file>] [--ticket-url <url>] [--pr-url <url>]");
      const claudeUsd = opts["claude-usd"] === undefined ? undefined : Number(opts["claude-usd"]);
      if (claudeUsd !== undefined && !(claudeUsd >= 0)) throw new UsageError("--claude-usd must be a non-negative number.");
      // Both would count one run's cost twice.
      if (claudeUsd !== undefined && opts["claude-result"]) throw new UsageError("Use --claude-usd or --claude-result, not both.");
      const links = {
        ...(opts["ticket-url"] ? { ticket: httpsUrl(opts["ticket-url"]) } : {}),
        ...(opts["pr-url"] ? { pr: httpsUrl(opts["pr-url"]) } : {}),
      };
      const claudeRun = opts["claude-result"] ? readClaudeResult(opts["claude-result"]) : undefined;
      const run = updateRun(config.runsDir, id, { claudeUsd, claudeRun, links, title: opts.title });
      out(`Updated ${id}.`, run);
      return 0;
    }

    case "calibrate": {
      const file = need(rest[0], "calibrate <labels.json>");
      const labels = JSON.parse(readFileSync(file, "utf8")) as LabelsFile;
      const model = pickModel(opts, config);
      if (!model) throw new UsageError("calibrate needs TYPESAFE_API_KEY or --recorded <file>.");
      const result = await calibrate(labels, config, model);
      out(calibrationReport(result), result);
      return 0;
    }

    case "tracker":
      return trackerCommand(rest[0], opts, config, out);

    case "config":
      process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
      return 0;

    case "prompt": {
      if (rest[0] !== "spec-writer") throw new UsageError("Usage: seula prompt spec-writer --run <id> --ticket <file>");
      const runId = need(opts.run, "prompt spec-writer --run <id> --ticket <file>");
      const ticketFile = need(opts.ticket, "prompt spec-writer --run <id> --ticket <file>");
      const designLink = readRun(config.runsDir, runId)?.links.design;
      process.stdout.write(renderSpecWriterPrompt(config, { runId, ticketFile, seulaCmd: opts["seula-cmd"] ?? "npx -y github:JJJohansson/seula", designLink, previousSpec: opts["previous-spec"] }));
      return 0;
    }

    case "init": {
      const tracker = need(opts.tracker, "init --tracker <jira|github>");
      if (tracker !== "jira" && tracker !== "github") throw new UsageError(`Unknown tracker "${tracker}". Use jira or github.`);
      const result = init({
        cwd: process.cwd(),
        tracker,
        specDir: opts["spec-dir"],
        designFirst: opts["design-first"],
        seulaRef: opts["seula-ref"],
        force: opts.force,
      });
      out(initReport(result), result);
      return 0;
    }

    default:
      throw new UsageError(`Unknown command "${command}". Run "seula help".`);
  }
}

async function trackerCommand(
  sub: string | undefined,
  opts: Options,
  config: SeulaConfig,
  out: (text: string, data: unknown) => void,
): Promise<number> {
  const type = (opts.tracker ?? config.tracker.type) as TrackerType;
  if (type !== "jira" && type !== "github") throw new UsageError(`Unknown tracker "${type}". Use jira or github.`);
  const tracker = makeTracker(config, type);
  switch (sub) {
    case "ticket": {
      const eventFile = need(opts.event, "tracker ticket --event <file> --out <file>");
      const outFile = need(opts.out, "tracker ticket --event <file> --out <file>");
      const ticket = tracker.ticketFromEvent(JSON.parse(readFileSync(eventFile, "utf8")));
      mkdirSync(dirname(outFile), { recursive: true });
      writeFileSync(outFile, ticketMarkdown(ticket));
      process.stdout.write(`${JSON.stringify({ key: ticket.key, runId: ticket.runId, title: ticket.title, url: ticket.url })}\n`);
      return 0;
    }
    case "comments": {
      const usage = "tracker comments --key <key> --append <ticket file>";
      const key = need(opts.key, usage);
      const file = need(opts.append, usage);
      const limits = { maxComments: config.tracker.maxComments, maxCommentChars: config.tracker.maxCommentChars };
      for (const [name, value] of Object.entries(limits)) {
        if (!Number.isSafeInteger(value) || value < 1) throw new UsageError(`tracker.${name} in the config must be a whole number above 0.`);
      }
      if (!tracker.keyPattern.test(key)) throw new UsageError(`Invalid ticket key "${key}".`);
      const result = await appendComments(file, tracker, key, limits);
      out(`Added ${result.added} comment(s) of ${key} to ${file}; ${result.leftOut} left out.`, { key, ...result });
      return 0;
    }
    case "comment": {
      const key = need(opts.key, "tracker comment --key <key> --text-file <file>");
      const text = readFileSync(need(opts["text-file"], "tracker comment --key <key> --text-file <file>"), "utf8");
      await tracker.comment(key, text);
      out(`Commented on ${key}.`, { key, commented: true });
      return 0;
    }
    case "move": {
      const key = need(opts.key, "tracker move --key <key> --state <needsInput|specReview>");
      const state = opts.state as TrackerState;
      if (state !== "needsInput" && state !== "specReview") throw new UsageError("--state must be needsInput or specReview.");
      await tracker.move(key, state);
      out(`Moved ${key} to ${state}.`, { key, state });
      return 0;
    }
    default:
      throw new UsageError("Usage: seula tracker ticket|comments|comment|move …");
  }
}

async function gateG0(opts: Options, config: SeulaConfig, out: (text: string, data: unknown) => void): Promise<number> {
  const ticketFile = need(opts.ticket, "gate g0 --ticket <file>");
  const ticket = readFileSync(ticketFile, "utf8");
  // The word count needs no model, so it runs even without a key (like G1's format rules).
  const tooShort = wordCount(ticket) < config.minTicketWords;
  const model = pickModel(opts, config) ?? (tooShort ? NO_MODEL : undefined);
  if (!model) {
    record(opts, config, { gate: "G0", result: "skipped", summary: "Jev skipped: no TYPESAFE_API_KEY" }, { title: opts.title });
    out(skippedText("G0"), { decision: "skipped", asks: [], notes: [] });
    return EXIT.skipped;
  }
  const result = await jevTicket(ticket, config, model);
  const run = record(
    opts,
    config,
    {
      gate: "G0",
      result: result.decision,
      summary: ticketSummary(result),
      feedback: [...result.asks, ...result.notes].length ? [...result.asks, ...result.notes] : undefined,
      costUsd: result.costUsd,
    },
    { title: opts.title, links: result.designLink ? { design: result.designLink } : undefined },
  );
  out(formatTicket(ticketFile, result) + blockedText(run), { ...result, blocked: run?.blocked });
  return run?.blocked ? EXIT_BLOCKED : EXIT[result.decision];
}

class UsageError extends Error {}

/** Stands in when a check returns before any model call. Calling it is a bug. */
const NO_MODEL: DecisionModel = {
  name: "none",
  evaluate: async () => {
    throw new Error("No decision model available.");
  },
};

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      run: { type: "string" },
      title: { type: "string" },
      "claude-usd": { type: "string" },
      "claude-result": { type: "string" },
      "ticket-url": { type: "string" },
      "pr-url": { type: "string" },
      ticket: { type: "string" },
      recorded: { type: "string" },
      record: { type: "string" },
      config: { type: "string" },
      json: { type: "boolean", default: false },
      tracker: { type: "string" },
      event: { type: "string" },
      out: { type: "string" },
      key: { type: "string" },
      state: { type: "string" },
      "text-file": { type: "string" },
      append: { type: "string" },
      "seula-cmd": { type: "string" },
      "previous-spec": { type: "string" },
      "spec-dir": { type: "string" },
      "design-first": { type: "boolean", default: false },
      "seula-ref": { type: "string" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
}

/** Claude Code's JSON output, or nothing with a warning: a crashed run may leave no JSON (run-files edge case). */
function readClaudeResult(file: string): ClaudeRun | undefined {
  try {
    return claudeRunFromOutput(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    process.stderr.write(`Warning: ${file} is missing or not JSON; no Claude cost stored from it.\n`);
    return undefined;
  }
}

function httpsUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(`Not a URL: ${value}`);
  }
  if (url.protocol !== "https:") throw new UsageError(`Only https links are stored: ${value}`);
  return url.toString();
}

function need(value: string | undefined, usage: string): string {
  if (!value) throw new UsageError(`Usage: seula ${usage}`);
  return value;
}

function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env here; the environment is enough.
  }
}

function readSpec(file: string, config: SeulaConfig): ParsedSpec {
  return parseSpec(readFileSync(file, "utf8"), config);
}

function readTicket(file: string | undefined): string | undefined {
  return file ? readFileSync(file, "utf8") : undefined;
}

function pickModel(opts: Options, config: SeulaConfig): DecisionModel | undefined {
  if (opts.recorded) return new RecordedModel(opts.recorded);
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return undefined;
  const live = new JevHttpModel(key, config.jev);
  return opts.record ? new RecordingModel(live, opts.record) : live;
}

function record(
  opts: Options,
  config: SeulaConfig,
  event: { gate: GateId; result: EventResult; summary: string; feedback?: string[]; costUsd?: number },
  extra: { title?: string; spec?: string; links?: RunFile["links"] } = {},
): RunFile | undefined {
  if (!opts.run) return undefined;
  return appendEvent(config.runsDir, opts.run, event, { ...extra, maxBacks: config.maxBacks });
}

function recordSpec(
  opts: Options,
  config: SeulaConfig,
  gate: GateId,
  spec: ParsedSpec,
  file: string,
  result: EventResult,
  summary: string,
  feedback?: string[],
  costUsd?: number,
): RunFile | undefined {
  return record(
    opts,
    config,
    { gate, result, summary, feedback: feedback?.length ? feedback : undefined, costUsd },
    { title: spec.title?.replace(/^FEATURE:\s*/i, ""), spec: relative(process.cwd(), file).replaceAll("\\", "/") },
  );
}

// ── formatting ──────────────────────────────────────────────────────────────

const MARK = { error: "✗", warn: "!", info: "i" } as const;
const DECISION_MARK: Record<Decision, string> = { pass: "✓", review: "?", back: "↺" };

function formatCheck(file: string, r: CheckSpecResult): string {
  const lines = [`G1 · spec format · ${file}`];
  for (const f of r.findings) {
    lines.push(`  ${MARK[f.severity]} ${f.severity.padEnd(5)} ${f.line ? `line ${f.line}`.padEnd(9) : "".padEnd(9)} ${f.message}`);
  }
  lines.push(`Result: ${r.ok ? "PASS" : "BACK"} (${formatFindingsSummary(r)})`);
  return lines.join("\n");
}

function formatFindingsSummary(r: CheckSpecResult): string {
  const n = (s: string) => r.findings.filter((f) => f.severity === s).length;
  return `${n("error")} errors, ${n("warn")} warnings`;
}

function findingLines(r: CheckSpecResult): string[] {
  return r.findings.filter((f) => f.severity !== "info").map((f) => `${f.line ? `line ${f.line}: ` : ""}${f.message}`);
}

function formatJev(file: string, r: JevSpecResult): string {
  const lines = [`G1 · Jev · ${file}  (${r.model}, ${r.inputTokens} tokens, $${r.costUsd.toFixed(5)})`];
  for (const c of r.criteria) {
    const qs = c.questions.map((q) => `${q.question} ${q.goodness.toFixed(2)}${DECISION_MARK[q.decision]}`).join("  ");
    lines.push(`  criterion ${c.number.padEnd(3)} ${c.decision.padEnd(6)} ${qs}`);
  }
  lines.push(`Result: ${r.decision.toUpperCase()} — ${jevSummary(r)}`);
  const fb = feedbackLines(r);
  if (fb.length) lines.push("Feedback:", ...fb.map((l) => `  ${l}`));
  return lines.join("\n");
}

function jevSummary(r: JevSpecResult): string {
  const back = r.criteria.filter((c) => c.decision === "back").length;
  const review = r.criteria.filter((c) => c.decision === "review").length;
  if (!back && !review) return `all ${r.criteria.length} criteria pass`;
  return [back && `${back} to rework`, review && `${review} unsure`].filter(Boolean).join(", ");
}

function formatTicket(file: string, r: JevTicketResult): string {
  const lines = [`G0 · ticket · ${file}  (${r.model}, ${r.inputTokens} tokens, $${r.costUsd.toFixed(5)})`];
  for (const q of r.questions) {
    lines.push(`  ${q.question.padEnd(18)} ${q.goodness.toFixed(2)}${DECISION_MARK[q.routed]}  (${q.onFail})`);
  }
  lines.push(`Result: ${r.decision.toUpperCase()} — ${ticketSummary(r)}`);
  if (r.asks.length) lines.push("Ask on the ticket:", ...r.asks.map((a) => `  - ${a}`));
  if (r.notes.length) lines.push("Notes:", ...r.notes.map((n) => `  - ${n}`));
  return lines.join("\n");
}

function ticketSummary(r: JevTicketResult): string {
  if (r.decision === "pass") return r.notes.length ? `ready, ${r.notes.length} note(s)` : "ready to write a spec";
  if (r.decision === "back") return `needs input: ${r.asks.length} question(s) for the ticket`;
  return "a person must check the ticket";
}

function skippedText(gate: GateId): string {
  return `${gate} · Jev · skipped: set TYPESAFE_API_KEY (or use --recorded <file>) to run the Jev checks.`;
}

function blockedText(run: RunFile | undefined): string {
  return run?.blocked ? `\nSTOP: ${run.blocked} A person must step in.` : "";
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    if (err instanceof UsageError || err instanceof TicketError) {
      process.stderr.write(`${err.message}\n`);
      process.exitCode = 64;
    } else if (err instanceof CredentialError) {
      process.stderr.write(`seula: ${err.message}\n`);
      process.exitCode = EXIT_CREDENTIAL;
    } else {
      process.stderr.write(`seula: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = EXIT_ERROR;
    }
  },
);
