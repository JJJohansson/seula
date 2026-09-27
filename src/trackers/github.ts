/** GitHub Issues adapter (specs/trackers.md criteria 4, 5, 6, 7, 8, 10). */
import type { TrackerState } from "../config.ts";
import { type CommentPage, type Ticket, TicketError, type Tracker, failIfNotOk, httpsOrEmpty, ticketComment } from "./types.ts";

export interface GitHubEnv {
  GITHUB_TOKEN?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_API_URL?: string;
}

const LABEL_COLOR = "5319e7";
const PER_PAGE = 100;

/** The page number of rel="last" in a Link header, or 1. Only the number is used, never the URL. */
function lastPage(link: string | null): number {
  const m = /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link ?? "");
  const n = Number(m?.[1] ?? 1);
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

export class GitHubTracker implements Tracker {
  readonly type = "github" as const;
  readonly keyPattern = /^[1-9][0-9]*$/;
  private readonly env: GitHubEnv;
  private readonly states: Record<TrackerState, string>;
  private readonly triggerLabel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(env: GitHubEnv, states: Record<TrackerState, string>, triggerLabel: string, fetchImpl: typeof fetch = fetch) {
    this.env = env;
    this.states = states;
    this.triggerLabel = triggerLabel;
    this.fetchImpl = fetchImpl;
  }

  ticketFromEvent(event: unknown): Ticket {
    const issue = (event as { issue?: Record<string, unknown> } | null)?.issue;
    if (!issue || typeof issue !== "object") throw new TicketError("The event has no issue: is it an issues event?");
    const n = issue.number;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw new TicketError(`Invalid issue number: "${String(n)}"`);
    return {
      key: String(n),
      runId: `GH-${n}`,
      title: typeof issue.title === "string" ? issue.title : "",
      body: typeof issue.body === "string" ? issue.body : "",
      url: httpsOrEmpty(issue.html_url),
    };
  }

  async comments(key: string, max: number): Promise<CommentPage> {
    this.checkKey(key);
    // The API lists oldest first, so the newest comments are on the last pages. The Link header
    // gives the last page's number; the requests themselves always go to this adapter's own host.
    const path = `/issues/${key}/comments?per_page=${PER_PAGE}`;
    const read = async (page: number) => {
      const res = await this.api(page === 1 ? path : `${path}&page=${page}`, { method: "GET" });
      await failIfNotOk(res, `GitHub comments of #${key}`);
      const items = (await res.json()) as { user?: { login?: string }; created_at?: string; body?: unknown }[];
      return { res, items: Array.isArray(items) ? items : [] };
    };
    const first = await read(1);
    const last = lastPage(first.res.headers.get("link"));
    let items = first.items;
    let total = items.length;
    if (last > 1) {
      const lastItems = (await read(last)).items;
      total = (last - 1) * PER_PAGE + lastItems.length;
      // Only the pages that hold the newest `max` comments: at most max / PER_PAGE + 2 reads.
      const from = Math.floor(Math.max(0, total - max) / PER_PAGE) + 1;
      const middle: typeof items[] = [];
      for (let page = from; page < last; page++) middle.push(page === 1 ? first.items : (await read(page)).items);
      items = [...middle.flat(), ...lastItems];
    }
    const comments = items.slice(-max).map((x) => ticketComment(x.user?.login ?? "", x.created_at ?? "", typeof x.body === "string" ? x.body : ""));
    return { comments, total };
  }

  async comment(key: string, text: string): Promise<void> {
    this.checkKey(key);
    const res = await this.api(`/issues/${key}/comments`, { method: "POST", body: JSON.stringify({ body: text }) });
    await failIfNotOk(res, `GitHub comment on #${key}`);
  }

  async move(key: string, state: TrackerState): Promise<void> {
    this.checkKey(key);
    const target = this.states[state];
    const remove = [...Object.values(this.states), this.triggerLabel].filter((l) => l !== target);
    for (const label of remove) {
      const res = await this.api(`/issues/${key}/labels/${encodeURIComponent(label)}`, { method: "DELETE" });
      if (res.status !== 404) await failIfNotOk(res, `GitHub remove label "${label}" from #${key}`);
    }
    // Create the label if it doesn't exist yet (422 means it already does).
    const create = await this.api("/labels", { method: "POST", body: JSON.stringify({ name: target, color: LABEL_COLOR }) });
    if (create.status !== 422) await failIfNotOk(create, `GitHub create label "${target}"`);
    const add = await this.api(`/issues/${key}/labels`, { method: "POST", body: JSON.stringify({ labels: [target] }) });
    await failIfNotOk(add, `GitHub add label "${target}" to #${key}`);
  }

  private checkKey(key: string): void {
    if (!this.keyPattern.test(key)) throw new TicketError(`Invalid issue number: "${key}"`);
  }

  private api(path: string, init: RequestInit): Promise<Response> {
    const { GITHUB_TOKEN, GITHUB_REPOSITORY } = this.env;
    if (!GITHUB_TOKEN) throw new TicketError("Set GITHUB_TOKEN to use the GitHub tracker.");
    if (!GITHUB_REPOSITORY || !/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPOSITORY)) {
      throw new TicketError("Set GITHUB_REPOSITORY to owner/repo to use the GitHub tracker.");
    }
    const base = (this.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, "");
    return this.fetchImpl(`${base}/repos/${GITHUB_REPOSITORY}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
        "user-agent": "seula",
      },
      signal: AbortSignal.timeout(30_000),
    });
  }
}
