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

/** One comment on a ticket (specs/trackers.md criteria 10–11). */
export interface TicketComment {
  author: string;
  /** The tracker's timestamp, as it sent it. */
  created: string;
  body: string;
  /** Starts with one of seula's own prefixes. A label for readers, never a trust signal. */
  fromSeula: boolean;
}

/** The newest comments, oldest first, and how many the ticket has in total. */
export interface CommentPage {
  comments: TicketComment[];
  total: number;
}

export interface Tracker {
  readonly type: TrackerType;
  /** Checks a key given on the command line. */
  readonly keyPattern: RegExp;
  ticketFromEvent(event: unknown): Ticket;
  /** The newest `max` comments of the ticket, oldest first. */
  comments(key: string, max: number): Promise<CommentPage>;
  comment(key: string, text: string): Promise<void>;
  move(key: string, state: TrackerState): Promise<void>;
}

/** Every comment seula posts starts with one of these (ticket-to-spec workflow criteria 3, 9, 17). */
const SEULA_PREFIXES = ["seula · ", "seula failed to run"];

export function ticketComment(author: string, created: string, body: string): TicketComment {
  const start = body.trimStart();
  return { author, created, body, fromSeula: SEULA_PREFIXES.some((p) => start.startsWith(p)) };
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
