/** Jira Cloud adapter (specs/trackers.md criteria 3, 5, 6, 8, 10). */
import type { TrackerState } from "../config.ts";
import { type CommentPage, type Ticket, TicketError, type Tracker, TrackerApiError, failIfNotOk, httpsOrEmpty, ticketComment } from "./types.ts";

export interface JiraEnv {
  JIRA_BASE_URL?: string;
  JIRA_EMAIL?: string;
  JIRA_API_TOKEN?: string;
}

export class JiraTracker implements Tracker {
  readonly type = "jira" as const;
  readonly keyPattern = /^[A-Z][A-Z0-9]+-[0-9]+$/;
  private readonly env: JiraEnv;
  private readonly states: Record<TrackerState, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(env: JiraEnv, states: Record<TrackerState, string>, fetchImpl: typeof fetch = fetch) {
    this.env = env;
    this.states = states;
    this.fetchImpl = fetchImpl;
  }

  ticketFromEvent(event: unknown): Ticket {
    const p = (event as { client_payload?: Record<string, unknown> } | null)?.client_payload;
    if (!p || typeof p !== "object") throw new TicketError("The event has no client_payload: is it a repository_dispatch from Jira?");
    const key = typeof p.key === "string" ? p.key : "";
    if (!this.keyPattern.test(key)) throw new TicketError(`Invalid Jira key: "${key}"`);
    return {
      key,
      runId: key,
      title: typeof p.summary === "string" ? p.summary : "",
      body: typeof p.description === "string" ? p.description : "",
      url: httpsOrEmpty(p.url),
    };
  }

  async comments(key: string, max: number): Promise<CommentPage> {
    this.checkKey(key);
    const res = await this.api(`/rest/api/2/issue/${key}/comment?orderBy=-created&maxResults=${max}`, { method: "GET" });
    await failIfNotOk(res, `Jira comments of ${key}`);
    const data = (await res.json()) as { total?: number; comments?: { author?: { displayName?: string }; created?: string; body?: unknown }[] };
    const newestFirst = (data.comments ?? []).slice(0, max);
    const comments = newestFirst.reverse().map((x) => ticketComment(x.author?.displayName ?? "", x.created ?? "", typeof x.body === "string" ? x.body : ""));
    return { comments, total: Math.max(data.total ?? 0, comments.length) };
  }

  async comment(key: string, text: string): Promise<void> {
    this.checkKey(key);
    const res = await this.api(`/rest/api/2/issue/${key}/comment`, { method: "POST", body: JSON.stringify({ body: text }) });
    await failIfNotOk(res, `Jira comment on ${key}`);
  }

  async move(key: string, state: TrackerState): Promise<void> {
    this.checkKey(key);
    const target = this.states[state];
    const res = await this.api(`/rest/api/2/issue/${key}/transitions`, { method: "GET" });
    await failIfNotOk(res, `Jira transitions for ${key}`);
    const data = (await res.json()) as { transitions?: { id: string; to?: { name?: string } }[] };
    const t = data.transitions?.find((x) => x.to?.name?.toLowerCase() === target.toLowerCase());
    if (!t) throw new TrackerApiError(`No Jira transition to "${target}" from ${key}'s current status.`);
    const post = await this.api(`/rest/api/2/issue/${key}/transitions`, { method: "POST", body: JSON.stringify({ transition: { id: t.id } }) });
    await failIfNotOk(post, `Jira move of ${key} to "${target}"`);
  }

  private checkKey(key: string): void {
    if (!this.keyPattern.test(key)) throw new TicketError(`Invalid Jira key: "${key}"`);
  }

  private api(path: string, init: RequestInit): Promise<Response> {
    const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = this.env;
    if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
      throw new TicketError("Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN to use the Jira tracker.");
    }
    if (!JIRA_BASE_URL.startsWith("https://")) throw new TicketError("JIRA_BASE_URL must start with https://");
    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
    return this.fetchImpl(`${JIRA_BASE_URL.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: { authorization: `Basic ${auth}`, accept: "application/json", "content-type": "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  }
}
