/** The one interface every issue tracker adapter implements (specs/trackers.md criterion 1). */
import { TRACKER_STATES, type TrackerState, type TrackerStates, type TrackerType } from "../config.ts";
import { CredentialError } from "../errors.ts";

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

/** A ticket's state as the tracker names it, and the configured state it matches (trackers criterion 14). */
export interface TicketState {
  status: string | null;
  state: TrackerState | null;
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
  /** The key at the start of a seula branch name (trackers criterion 16, board-sync criterion 2). */
  keyFromBranch(branch: string): string;
  /** The newest `max` comments of the ticket, oldest first. */
  comments(key: string, max: number): Promise<CommentPage>;
  comment(key: string, text: string): Promise<void>;
  state(key: string): Promise<TicketState>;
  move(key: string, state: TrackerState): Promise<void>;
}

/** Every comment seula posts starts with one of these (ticket-to-spec workflow criteria 3, 9, 17). */
const SEULA_PREFIXES = ["seula · ", "seula failed to run"];

export function ticketComment(author: string, created: string, body: string): TicketComment {
  const start = body.trimStart();
  return { author, created, body, fromSeula: SEULA_PREFIXES.some((p) => start.startsWith(p)) };
}

/** The configured state whose name matches `status`, ignoring case, or null. */
export function matchState(states: TrackerStates, status: string | null): TrackerState | null {
  if (status === null) return null;
  return TRACKER_STATES.find((s) => states[s]?.toLowerCase() === status.toLowerCase()) ?? null;
}

/** The configured name of `state`. A state that is not configured is a usage error. */
export function stateName(states: TrackerStates, state: TrackerState): string {
  const name = states[state];
  if (!name) throw new TicketError(`tracker.states.${state} is not set in seula.config.json.`);
  return name;
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

/**
 * Throws for a failed response. A 401 or 403 is a refused credential (trackers criterion 9): its
 * message names `credential` and leaves out the response body, which can echo the value. A 403
 * for a rate limit is an ordinary API error.
 */
export async function failIfNotOk(res: Response, what: string, credential: string): Promise<void> {
  if (res.ok) return;
  const rateLimited = res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after");
  if (res.status === 401 || (res.status === 403 && !rateLimited)) {
    throw new CredentialError(
      `${what} failed: the tracker refused ${credential} (HTTP ${res.status}). It may be expired, revoked, or missing a permission.`,
    );
  }
  const detail = (await res.text()).slice(0, 300);
  throw new TrackerApiError(`${what} failed: HTTP ${res.status}: ${detail}`);
}

/** Writes the ticket as the markdown file the gates and the agent read. */
export function ticketMarkdown(t: Ticket): string {
  return `# ${t.key}: ${t.title}\n\nSource: ${t.url || "(no link)"}\n\n${t.body.trim()}\n`;
}
