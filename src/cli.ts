#!/usr/bin/env node
/**
 * The `seula` command. It parses the arguments, runs one command, prints text or `--json`, and
 * turns the result into an exit code (docs/quality-gates.md, "Exit codes"). The gate logic lives
 * in src/gates/ and the other modules; this file only wires them up.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { parseArgs } from "node:util";
import { calibrate, calibrationReport, type LabelsFile } from "./calibrate.ts";
import { type SeulaConfig, type TrackerType, isTrackerState, loadConfig, trackerStates } from "./config.ts";
import { CredentialError, UsageError } from "./errors.ts";
import { approveSpec } from "./approve.ts";
import { checkPlan } from "./gates/checkPlan.ts";
import { jevPlan, planFeedbackLines } from "./gates/jevPlan.ts";
import { type CheckSpecResult, checkSpec } from "./gates/checkSpec.ts";
import { type JevSpecResult, feedbackLines, jevSpec } from "./gates/jevSpec.ts";
import { type JevTicketResult, jevTicket, wordCount } from "./gates/jevTicket.ts";
import { type DecisionModel, JevHttpModel, RecordedModel, RecordingModel } from "./jev/model.ts";
import type { Decision } from "./routing.ts";
import { type ClaudeRun, type EventResult, type GateId, type RunFile, appendEvent, claudeRunFromOutput, readRun, readRuns, updateRun } from "./runs.ts";
import { type ParsedSpec, parseSpec } from "./spec.ts";
import { init, initReport } from "./init.ts";
import { renderPlannerPrompt, renderSpecWriterPrompt } from "./prompts.ts";
import { statusTable } from "./status.ts";
import { appendComments } from "./trackers/comments.ts";
import { makeTracker } from "./trackers/index.ts";
import { TicketError, type Tracker, ticketMarkdown } from "./trackers/types.ts";

const HELP = `seula: spec-driven quality gates for AI coding agents

Usage:
  seula gate g0 --ticket <file>  G0: is the ticket ready to write a spec from?
  seula gate g1 <spec.md>        G1: format rules, then Jev on each criterion
  seula gate g2 <spec.md>        G2: the plan covers every criterion (--approved <file>: nothing else changed)
  seula check-spec <spec.md>…    G1 format rules only (no model); several specs allowed
  seula jev-spec <spec.md>       G1 Jev questions only
  seula status                   Where each feature is, gate by gate
  seula update --run <id>        Add --claude-usd <n> or --claude-result <file>, --ticket-url <url> or --pr-url <url> to a run
  seula calibrate <labels.json>  Pick Jev cut-offs from labeled examples

  seula init --tracker <jira|github> --seula-ref <full SHA|tag|branch>   Set seula up in this repo (config + workflows)
  seula tracker ticket --event <file> --out <file>        Ticket file from a trigger event
  seula tracker comments --key <key> --append <file>      Add the ticket's comments to a ticket file
  seula tracker comment --key <key> --text-file <file>    Comment on a ticket
  seula tracker key --branch <seula branch>               The ticket key and run id from a branch name (no API call)
  seula tracker state --key <key> [--fail-on <state>]     The ticket's state; exits 1 when it is in <state>
  seula tracker move --key <key> --state <needsInput|specReview|planning>
                                 (state and move: --branch <seula branch> in place of --key)
  seula prompt spec-writer --run <id> --ticket <file>     The spec-writer prompt for a run
                                 (--previous-spec <file>: an earlier run's draft to update)
  seula prompt planner --run <id> --spec <file> --approved <file>   The planner prompt for an approved spec
  seula approve <spec.md> --pr <number>   Mark a merged spec Approved in its status line
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
  init: --spec-dir <dir>  --design-first  --force

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

// The exit codes are part of seula's contract: workflows and agents act on them. 64 comes from a
// UsageError or TicketError, at the bottom of this file.
const EXIT: Record<Decision | "skipped", number> = { pass: 0, skipped: 0, back: 1, review: 2 };
const EXIT_BLOCKED = 3;
const EXIT_ERROR = 70;
const EXIT_CREDENTIAL = 77;

/** Every option of every command. `parse` lists the same names with their types. */
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
  branch?: string;
  state?: string;
  "fail-on"?: string;
  "text-file"?: string;
  append?: string;
  "seula-cmd"?: string;
  "previous-spec"?: string;
  approved?: string;
  pr?: string;
  spec?: string;
  "spec-dir"?: string;
  "design-first"?: boolean;
  "seula-ref"?: string;
  force?: boolean;
}

/** Runs one command and returns its exit code. Errors are thrown, and mapped to 64, 70 or 77 below. */
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
    // G1's format rules only, no model, on one or more specs (g1 criteria 1-9).
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

    // G1's Jev half only, without the format rules (g1 criteria 11-17).
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

    // G0 and G2 have their own functions. G1 is here: the format rules, then Jev only when they
    // pass (g1 criterion 10).
    case "gate": {
      const gate = (rest[0] ?? "").toUpperCase();
      if (gate === "G0") return gateG0(opts, config, out);
      if (gate === "G2") return gateG2(rest[1], opts, config, out);
      if (gate !== "G1") throw new UsageError(`Unknown gate "${rest[0] ?? ""}". Available: g0, g1, g2.`);
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

    // Every run file as a table: the step, the gate history and who acts next (run-files criteria 8-9).
    case "status": {
      const runs = readRuns(config.runsDir);
      out(statusTable(runs), runs);
      return 0;
    }

    // Adds links or Claude's cost to a run without a gate event (run-files criteria 7 and 10).
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

    // Recommends Jev cut-offs from labeled examples (specs/calibration.md). It needs answers from
    // Jev, live or recorded, so without either it is a usage error (criterion 7).
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

    // The plan step records a merged spec's approval in its status line (spec-to-plan criterion 15).
    case "approve": {
      const usage = "approve <spec.md> --pr <number>";
      const file = need(rest[0], usage);
      const pr = need(opts.pr, usage);
      const markdown = readFileSync(file, "utf8");
      writeFileSync(file, approveSpec(markdown, config, /^\d+$/.test(pr) ? Number(pr) : Number.NaN));
      out(`Approved ${file} (merged in #${pr}).`, { spec: file, pr: Number(pr) });
      return 0;
    }

    case "config":
      process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
      return 0;

    // The spec-writer and planner prompts for a workflow run (agent-plugin criteria 7-14). They
    // name the ticket and spec files and never contain their text.
    case "prompt": {
      if (rest[0] === "planner") {
        const usage = "prompt planner --run <id> --spec <file> --approved <file>";
        const input = { runId: need(opts.run, usage), specFile: need(opts.spec, usage), approvedFile: need(opts.approved, usage) };
        process.stdout.write(renderPlannerPrompt(config, { ...input, seulaCmd: opts["seula-cmd"] ?? "npx -y github:JJJohansson/seula" }));
        return 0;
      }
      if (rest[0] !== "spec-writer") throw new UsageError("Usage: seula prompt spec-writer|planner … (see seula help)");
      const runId = need(opts.run, "prompt spec-writer --run <id> --ticket <file>");
      const ticketFile = need(opts.ticket, "prompt spec-writer --run <id> --ticket <file>");
      const designLink = readRun(config.runsDir, runId)?.links.design;
      process.stdout.write(renderSpecWriterPrompt(config, { runId, ticketFile, seulaCmd: opts["seula-cmd"] ?? "npx -y github:JJJohansson/seula", designLink, previousSpec: opts["previous-spec"] }));
      return 0;
    }

    // Writes the config and the caller workflows into the current repo (specs/adoption.md).
    case "init": {
      const tracker = need(opts.tracker, "init --tracker <jira|github> --seula-ref <full SHA|tag|branch>");
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

/** The ticket key from --key, or from a seula branch name with --branch (trackers criterion 16). */
function ticketKey(opts: Options, tracker: Tracker, usage: string): string {
  if (opts.key !== undefined && opts.branch !== undefined) throw new UsageError("Give --key or --branch, not both.");
  if (opts.branch !== undefined) return tracker.keyFromBranch(opts.branch);
  return need(opts.key, usage);
}

/**
 * `seula tracker …`: the commands the workflows use to read and change tickets (specs/trackers.md).
 * The gates never call a tracker; only these commands do.
 */
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
    case "key": {
      // trackers criterion 17: from the branch name only; no API call, no credential.
      const key = tracker.keyFromBranch(need(opts.branch, "tracker key --branch <seula branch>"));
      const runId = tracker.type === "github" ? `GH-${key}` : key;
      process.stdout.write(`${JSON.stringify({ key, runId })}\n`);
      return 0;
    }
    case "state": {
      const key = ticketKey(opts, tracker, "tracker state --key <key> [--fail-on <needsInput|specReview|planning>]");
      const failOn = opts["fail-on"];
      if (failOn !== undefined && !isTrackerState(failOn)) throw new UsageError("--fail-on must be needsInput, specReview or planning.");
      const { status, state } = await tracker.state(key);
      process.stdout.write(`${JSON.stringify({ key, status, state })}
`);
      if (failOn !== undefined && state === failOn) {
        process.stderr.write(`${key} is in the ${failOn} state ("${status}").
`);
        return 1;
      }
      return 0;
    }
    case "move": {
      const key = ticketKey(opts, tracker, "tracker move --key <key> --state <needsInput|specReview|planning>");
      const state = opts.state;
      if (!isTrackerState(state)) throw new UsageError("--state must be needsInput, specReview or planning.");
      // planning has no default: without the setting, the move is skipped (trackers criterion 15).
      if (!trackerStates({ ...config, tracker: { ...config.tracker, type } })[state]) {
        out(`Moved nothing: tracker.states.${state} is not set in seula.config.json.`, { key, state, moved: false });
        return 0;
      }
      await tracker.move(key, state);
      out(`Moved ${key} to ${state}.`, { key, state });
      return 0;
    }
    default:
      throw new UsageError("Usage: seula tracker ticket|comments|comment|key|state|move …");
  }
}

/** G0 (specs/g0-ticket-gate.md): the word count, then one Jev request with the ticket questions. */
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
      branch: { type: "string" },
      "fail-on": { type: "string" },
      "text-file": { type: "string" },
      append: { type: "string" },
      "seula-cmd": { type: "string" },
      "previous-spec": { type: "string" },
      approved: { type: "string" },
      pr: { type: "string" },
      spec: { type: "string" },
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

/** The value as a URL, when it is one and uses https. Run files store only https links (run-files criterion 7). */
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

/** Reads `.env` in the current folder into the environment, when there is one (for TYPESAFE_API_KEY and the tracker variables). */
function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env here; the environment is enough.
  }
}

/** G2 (specs/g2-plan-gate.md): the plan's script rules, then Jev's flag questions when they pass. */
async function gateG2(file: string | undefined, opts: Options, config: SeulaConfig, out: (text: string, data: unknown) => void): Promise<number> {
  const path = need(file, "gate g2 <spec.md> [--approved <file>]");
  const markdown = readFileSync(path, "utf8");
  const approved = opts.approved === undefined ? undefined : readFileSync(opts.approved, "utf8");
  const spec = parseSpec(markdown, config);
  const check = checkPlan(markdown, config, approved);
  const lines = [`G2 · plan · ${path}`];
  if (!check.ok) {
    const feedback = check.findings.map((f) => `plan · ${f.rule}: ${f.message}`);
    const run = recordSpec(opts, config, "G2", spec, path, "back", `${check.findings.length} plan errors`, feedback);
    out([...lines, ...feedback, `Result: BACK (${check.findings.length} errors)`].join("\n") + blockedText(run), {
      decision: "back",
      findings: check.findings,
      blocked: run?.blocked,
    });
    return run?.blocked ? EXIT_BLOCKED : EXIT.back;
  }
  lines.push(`Plan rules: pass (${check.tasks.length} tasks).`);
  const model = pickModel(opts, config);
  if (!model) {
    recordSpec(opts, config, "G2", spec, path, "skipped", "Jev skipped: no TYPESAFE_API_KEY");
    out([...lines, "Jev flags: skipped (no TYPESAFE_API_KEY).", "Result: PASS"].join("\n"), { decision: "skipped", tasks: check.tasks.length });
    return EXIT.skipped;
  }
  const result = await jevPlan(spec, config, model);
  const feedback = planFeedbackLines(result);
  const run = recordSpec(opts, config, "G2", spec, path, result.decision, `${result.flags.length} flags`, feedback, result.costUsd);
  const verdict = result.decision === "review" ? "UNSURE: a person reviews the flags" : "PASS";
  out([...lines, ...feedback, `Jev flags: ${result.flags.length}.`, `Result: ${verdict}`].join("\n") + blockedText(run), {
    ...result,
    tasks: check.tasks.length,
    blocked: run?.blocked,
  });
  return run?.blocked ? EXIT_BLOCKED : EXIT[result.decision];
}

function readSpec(file: string, config: SeulaConfig): ParsedSpec {
  return parseSpec(readFileSync(file, "utf8"), config);
}

function readTicket(file: string | undefined): string | undefined {
  return file ? readFileSync(file, "utf8") : undefined;
}

/**
 * The Jev model for a gate: recorded answers when `--recorded` is given, else the live API when
 * TYPESAFE_API_KEY is set, wrapped to save its answers when `--record` is given. Without either,
 * nothing, and the gate reports its Jev half as skipped.
 */
function pickModel(opts: Options, config: SeulaConfig): DecisionModel | undefined {
  if (opts.recorded) return new RecordedModel(opts.recorded);
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return undefined;
  const live = new JevHttpModel(key, config.jev);
  return opts.record ? new RecordingModel(live, opts.record) : live;
}

/** Adds a gate event to the run file when `--run` is given (run-files criterion 1), with the loop limit. */
function record(
  opts: Options,
  config: SeulaConfig,
  event: { gate: GateId; result: EventResult; summary: string; feedback?: string[]; costUsd?: number },
  extra: { title?: string; spec?: string; links?: RunFile["links"] } = {},
): RunFile | undefined {
  if (!opts.run) return undefined;
  return appendEvent(config.runsDir, opts.run, event, { ...extra, maxBacks: config.maxBacks });
}

/** `record` for a gate on a spec: the run file also gets the spec's title and its path from the repo root. */
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
// The text output of the gates. `--json` prints the result objects instead. The feedback lines
// are what the writing agent reads and what the run file stores.

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

// A usage error or an unusable ticket exits 64, a refused credential 77, anything else 70:
// nothing was decided.
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
