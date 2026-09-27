/**
 * Renders the spec-writer prompt for one run (specs/agent-plugin.md criteria 7-8,
 * specs/design-first.md criterion 7). The prompt names the ticket file; it never contains
 * ticket text.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { SeulaConfig } from "./config.ts";

/** The seula package root, from both src/ and dist/. */
export const SEULA_ROOT = resolve(import.meta.dirname, "..");

export interface SpecWriterInput {
  runId: string;
  ticketFile: string;
  seulaCmd: string;
  designLink?: string;
  /** A spec file that an earlier run for this ticket added (ticket-to-spec criterion 16). */
  previousSpec?: string;
  cwd?: string;
}

export function newSpecStatus(config: SeulaConfig): string {
  return config.statuses.find((s) => !config.buildableStatuses.includes(s)) ?? "Idea";
}

export function templateFor(config: SeulaConfig, cwd: string): string {
  if (config.template) return config.template;
  if (existsSync(join(cwd, "SPEC_DRIVEN_DEVELOPMENT.md"))) return "the template in SPEC_DRIVEN_DEVELOPMENT.md";
  return relative(cwd, join(SEULA_ROOT, "templates", "spec.md")).replaceAll("\\", "/");
}

export function designText(designLink: string | undefined): string {
  if (!designLink) return "The ticket links no design.";
  return (
    `The ticket links this design: ${designLink}. If it is a file or folder in this repo, read it before you write the ` +
    "criteria, and write criteria for the screens and states that it shows. Add a `## DESIGN` section to the spec that " +
    "links it. If the link is outside the repo, add it to the `## DESIGN` section, but do not try to open it."
  );
}

export function previousSpecText(previousSpec: string | undefined, specDir: string): string {
  if (!previousSpec) return "None.";
  const name = previousSpec.startsWith(`${specDir}/`) ? previousSpec.slice(specDir.length + 1) : "";
  if (!/^[a-z0-9][a-z0-9-]*\.md$/.test(name)) throw new Error(`Invalid earlier draft "${previousSpec}".`);
  return (
    `An earlier run for this ticket wrote ${previousSpec}. It is not in the index yet. ` +
    "Update that file. Keep its file name. Do not create another spec for this ticket."
  );
}

export function renderSpecWriterPrompt(config: SeulaConfig, input: SpecWriterInput): string {
  if (!/^[A-Za-z0-9._-]+$/.test(input.runId)) throw new Error(`Invalid run id "${input.runId}".`);
  if (!/^[\w./-]+$/.test(input.ticketFile)) throw new Error(`Unexpected characters in the ticket file path "${input.ticketFile}".`);
  const cwd = input.cwd ?? process.cwd();
  const template = readFileSync(join(SEULA_ROOT, "prompts", "spec-writer.md"), "utf8");
  const specDir = config.specDir.replace(/\/+$/, "");
  const values: Record<string, string> = {
    RUN_ID: input.runId,
    TICKET_FILE: input.ticketFile,
    SPEC_DIR: specDir,
    TEMPLATE: templateFor(config, cwd),
    SEULA: input.seulaCmd,
    NEW_STATUS: newSpecStatus(config),
    DESIGN: designText(input.designLink),
    PREVIOUS_SPEC: previousSpecText(input.previousSpec, specDir),
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, name: string) => values[name] ?? m);
}
