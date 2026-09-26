/** The one interface every issue tracker adapter implements (specs/trackers.md criterion 1). */
import type { TrackerState, TrackerType } from "../config.ts";

export interface Ticket {
  /** The tracker's own id: "PROJ-42" for Jira, "42" for a GitHub issue. */
  key: string;
  /** Safe for file names and run files: the Jira key, or "GH-42". */
  runId: string;
  title: string;
  body: string;
  /** https link to the ticket, or "" when the event had none. */
  url: string;
}

export interface Tracker {
  readonly type: TrackerType;
  /** Checks a key given on the command line. */
  readonly keyPattern: RegExp;
  ticketFromEvent(event: unknown): Ticket;
  comment(key: string, text: string): Promise<void>;
  move(key: string, state: TrackerState): Promise<void>;
}

/** The event or a key is not usable: a usage error (exit 64). */
export class TicketError extends Error {}

/** A tracker API call failed (exit 70). */
export class TrackerApiError extends Error {}

export function httpsOrEmpty(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    return new URL(value).protocol === "https:" ? value : "";
  } catch {
    return "";
  }
}

export async function failIfNotOk(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const detail = (await res.text()).slice(0, 300);
  throw new TrackerApiError(`${what} failed: HTTP ${res.status}: ${detail}`);
}

/** Writes the ticket as the markdown file the gates and the agent read. */
export function ticketMarkdown(t: Ticket): string {
  return `# ${t.key}: ${t.title}\n\nSource: ${t.url || "(no link)"}\n\n${t.body.trim()}\n`;
}
