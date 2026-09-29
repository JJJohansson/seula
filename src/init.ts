/**
 * `seula init`: set seula up in a repo (specs/adoption.md). Writes files only when they are
 * absent (unless forced), makes no network calls, and never writes secrets.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_FILE, DEFAULT_STATES, type TrackerType } from "./config.ts";
import { UsageError } from "./errors.ts";
import { SEULA_ROOT } from "./prompts.ts";

export interface InitOptions {
  cwd: string;
  tracker: TrackerType;
  specDir?: string;
  designFirst?: boolean;
  seulaRef?: string;
  force?: boolean;
}

export interface InitFile {
  path: string;
  action: "written" | "overwritten" | "skipped";
  note?: string;
}

export interface InitResult {
  files: InitFile[];
  warnings: string[];
  nextSteps: string[];
}

const TEMPLATE_PATH = ".seula/spec-template.md";
const TRIGGER_LABEL = "seula:ready-for-spec";

/** adoption criterion 2: specs/, else docs/specs/ when it exists, else specs/. */
export function detectSpecDir(cwd: string): string {
  if (existsSync(join(cwd, "specs"))) return "specs";
  if (existsSync(join(cwd, "docs", "specs"))) return "docs/specs";
  return "specs";
}

/**
 * adoption criterion 15: while seula has no release, the ref is required. GitHub Actions accepts
 * only a full 40-character commit SHA in `uses:`, so a shorter hex ref is refused.
 */
function checkSeulaRef(ref: string | undefined): string {
  if (ref === undefined || ref === "") {
    throw new UsageError(
      "Pass --seula-ref: seula has no release yet. Use a full 40-character commit SHA of seula (for example from " +
        "`git ls-remote https://github.com/JJJohansson/seula main`), a tag, or a branch.",
    );
  }
  if (!/^[\w./-]+$/.test(ref)) throw new UsageError(`Invalid seula ref "${ref}".`);
  if (/^[0-9a-f]{7,39}$/i.test(ref)) {
    throw new UsageError(`"${ref}" looks like a short commit SHA. GitHub Actions needs the full 40-character SHA in uses:.`);
  }
  return ref;
}

export function init(opts: InitOptions): InitResult {
  if (opts.tracker !== "jira" && opts.tracker !== "github") throw new UsageError(`Unknown tracker "${String(opts.tracker)}". Use jira or github.`);
  const specDir = (opts.specDir ?? detectSpecDir(opts.cwd)).replace(/\/+$/, "");
  if (!/^[\w.-]+(\/[\w.-]+)*$/.test(specDir) || specDir.split("/").includes("..")) throw new UsageError(`Invalid spec directory "${specDir}".`);
  const ref = checkSeulaRef(opts.seulaRef);

  const result: InitResult = { files: [], warnings: [], nextSteps: [] };
  if (!existsSync(join(opts.cwd, ".git"))) result.warnings.push("This folder is not a git repository. The workflows need a GitHub repository.");

  const needsTemplate = !existsSync(join(opts.cwd, "SPEC_DRIVEN_DEVELOPMENT.md")) && !existsSync(join(opts.cwd, TEMPLATE_PATH));
  const configPath = join(opts.cwd, CONFIG_FILE);
  const existingConfig = existsSync(configPath) ? (JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>) : undefined;

  const config: Record<string, unknown> = {
    specDir,
    ignore: [`${specDir}/README.md`],
    tracker: {
      type: opts.tracker,
      states: DEFAULT_STATES[opts.tracker],
      ...(opts.tracker === "github" ? { triggerLabel: TRIGGER_LABEL } : {}),
    },
    ...(needsTemplate || existingConfig?.template === TEMPLATE_PATH ? { template: TEMPLATE_PATH } : {}),
    ...(opts.designFirst ? { design: { required: true } } : {}),
  };

  const fill = (text: string) =>
    text.replaceAll("{{REF}}", ref).replaceAll("{{SPEC_DIR}}", specDir).replaceAll("{{TRIGGER_LABEL}}", TRIGGER_LABEL);
  const template = (name: string) => readFileSync(join(SEULA_ROOT, "templates", name), "utf8");

  const plan: { path: string; content: string; skipNote?: string }[] = [
    {
      path: CONFIG_FILE,
      content: `${JSON.stringify(config, null, 2)}\n`,
      skipNote: existingConfig && !existingConfig.tracker ? 'exists but has no "tracker" setting; add it or rerun with --force' : undefined,
    },
    { path: ".github/workflows/seula-ticket-to-spec.yml", content: fill(template(`workflows/ticket-to-spec.${opts.tracker}.yml`)) },
    { path: ".github/workflows/seula-spec-check.yml", content: fill(template("workflows/spec-check.yml")) },
    { path: ".github/workflows/seula-board-sync.yml", content: fill(template(`workflows/board-sync.${opts.tracker}.yml`)) },
    { path: ".github/workflows/seula-spec-to-plan.yml", content: fill(template(`workflows/spec-to-plan.${opts.tracker}.yml`)) },
  ];
  if (needsTemplate) plan.push({ path: TEMPLATE_PATH, content: template("spec.md") });

  for (const f of plan) {
    const abs = join(opts.cwd, f.path);
    const exists = existsSync(abs);
    if (exists && !opts.force) {
      result.files.push({ path: f.path, action: "skipped", note: f.skipNote ?? "already exists" });
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
    result.files.push({ path: f.path, action: exists ? "overwritten" : "written" });
  }

  // adoption criterion 9: the names the caller workflow reads, not the names seula's workflow declares.
  const secrets = ["SEULA_ANTHROPIC_API_KEY", "SEULA_GH_TOKEN", "SEULA_TYPESAFE_API_KEY (optional: without it the Jev checks are skipped)"];
  if (opts.tracker === "jira") secrets.push("JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN");
  result.nextSteps = [
    `Add these repository secrets (Settings → Secrets and variables → Actions): ${secrets.join(", ")}.`,
    `Follow the setup guide: https://github.com/JJJohansson/seula/blob/main/docs/setup-${opts.tracker === "jira" ? "jira" : "github-issues"}.md`,
    "Commit the new files and merge them to the default branch; the workflows only run from there.",
  ];
  return result;
}

export function initReport(r: InitResult): string {
  const lines = r.files.map((f) => `  ${f.action.padEnd(11)} ${f.path}${f.note ? `  (${f.note})` : ""}`);
  const warnings = r.warnings.map((w) => `Warning: ${w}`);
  return ["seula init", ...lines, ...(warnings.length ? ["", ...warnings] : []), "", "Next steps:", ...r.nextSteps.map((s, i) => `  ${i + 1}. ${s}`)].join(
    "\n",
  );
}
