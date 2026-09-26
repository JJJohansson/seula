/** GitHub Issues adapter (specs/trackers.md criteria 4, 5, 6, 7, 8). */
import type { TrackerState } from "../config.ts";
import { type Ticket, TicketError, type Tracker, failIfNotOk, httpsOrEmpty } from "./types.ts";

export interface GitHubEnv {
  GITHUB_TOKEN?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_API_URL?: string;
}

const LABEL_COLOR = "5319e7";

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
