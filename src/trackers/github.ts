/** GitHub Issues adapter (specs/trackers.md criteria 4, 5, 6, 7, 8, 10, 14, 16). */
import type { TrackerState, TrackerStates } from "../config.ts";
import { type CommentPage, type Ticket, TicketError, type TicketState, type Tracker, failIfNotOk, httpsOrEmpty, matchState, stateName, ticketComment } from "./types.ts";

export interface GitHubEnv {
  GITHUB_TOKEN?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_API_URL?: string;
}

/** Named in the error when GitHub refuses it (criterion 9). */
const CREDENTIAL = "GITHUB_TOKEN";
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
  private readonly states: TrackerStates;
  private readonly triggerLabel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(env: GitHubEnv, states: TrackerStates, triggerLabel: string, fetchImpl: typeof fetch = fetch) {
    this.env = env;
    this.states = states;
    this.triggerLabel = triggerLabel;
    this.fetchImpl = fetchImpl;
  }

  /** The ticket from an `issues` event. The run id is `GH-<number>`, so it can't clash with a Jira key. */
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

  /** The newest `max` comments, oldest first, and how many the issue has (criterion 10). */
  async comments(key: string, max: number): Promise<CommentPage> {
    this.checkKey(key);
    // The API lists oldest first, so the newest comments are on the last pages. The Link header
    // gives the last page's number; the requests themselves always go to this adapter's own host.
    const path = `/issues/${key}/comments?per_page=${PER_PAGE}`;
    const read = async (page: number) => {
      const res = await this.api(page === 1 ? path : `${path}&page=${page}`, { method: "GET" });
      await failIfNotOk(res, `GitHub comments of #${key}`, CREDENTIAL);
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
    await failIfNotOk(res, `GitHub comment on #${key}`, CREDENTIAL);
  }

  /** An issue's state is a label: the first of its labels that matches a configured state (criterion 14). */
  async state(key: string): Promise<TicketState> {
    this.checkKey(key);
    const res = await this.api(`/issues/${key}`, { method: "GET" });
    await failIfNotOk(res, `GitHub labels of #${key}`, CREDENTIAL);
    const data = (await res.json()) as { labels?: unknown[] };
    const names = (data.labels ?? []).map((l) => (typeof l === "string" ? l : (l as { name?: unknown } | null)?.name)).filter((n): n is string => typeof n === "string");
    const status = names.find((n) => matchState(this.states, n) !== null) ?? null;
    return { status, state: matchState(this.states, status) };
  }

  /**
   * Moves an issue by its labels: removes the other state labels and the trigger label, so the
   * issue has one state and a person can add the trigger label again to start a new run, then
   * adds the target label (criterion 6).
   */
  async move(key: string, state: TrackerState): Promise<void> {
    this.checkKey(key);
    const target = stateName(this.states, state);
    const remove = [...Object.values(this.states), this.triggerLabel].filter((l): l is string => !!l && l !== target);
    for (const label of remove) {
      const res = await this.api(`/issues/${key}/labels/${encodeURIComponent(label)}`, { method: "DELETE" });
      if (res.status !== 404) await failIfNotOk(res, `GitHub remove label "${label}" from #${key}`, CREDENTIAL);
    }
    // Create the label if it doesn't exist yet (422 means it already does).
    const create = await this.api("/labels", { method: "POST", body: JSON.stringify({ name: target, color: LABEL_COLOR }) });
    if (create.status !== 422) await failIfNotOk(create, `GitHub create label "${target}"`, CREDENTIAL);
    const add = await this.api(`/issues/${key}/labels`, { method: "POST", body: JSON.stringify({ labels: [target] }) });
    await failIfNotOk(add, `GitHub add label "${target}" to #${key}`, CREDENTIAL);
  }

  /** `seula/gh-42` and `seula/gh-42-<spec name>` give 42: the run id in lowercase, then the end or a dash. */
  keyFromBranch(branch: string): string {
    const m = /^seula\/gh-([1-9][0-9]*)(?:-|$)/i.exec(branch);
    if (!m?.[1]) throw new TicketError(`No issue number at the start of the branch name ${JSON.stringify(branch)}.`);
    return m[1];
  }

  private checkKey(key: string): void {
    if (!this.keyPattern.test(key)) throw new TicketError(`Invalid issue number: "${key}"`);
  }

  /** One call to the REST API for the issues of GITHUB_REPOSITORY, with GITHUB_TOKEN from the environment. */
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
