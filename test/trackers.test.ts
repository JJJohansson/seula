import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_STATES } from "../src/config.ts";
import { GitHubTracker } from "../src/trackers/github.ts";
import { makeTracker } from "../src/trackers/index.ts";
import { JiraTracker } from "../src/trackers/jira.ts";
import { TicketError, TrackerApiError, ticketMarkdown } from "../src/trackers/types.ts";
import { config } from "./helpers.ts";

interface Call {
  url: string;
  method: string;
  body?: unknown;
  headers: Record<string, string>;
}

/** A fake fetch that records calls and answers from a route table: "METHOD path-suffix" → [status, body]. */
function fakeFetch(routes: Record<string, [number, unknown]>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers as Record<string, string> });
    const hit = Object.entries(routes).find(([k]) => {
      const [m, suffix] = k.split(" ");
      return m === method && url.endsWith(suffix ?? "");
    });
    const [status, body] = hit?.[1] ?? [404, { message: "not found" }];
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const JIRA_ENV = { JIRA_BASE_URL: "https://acme.atlassian.net/", JIRA_EMAIL: "me@acme.test", JIRA_API_TOKEN: "t0k3n" };
const GH_ENV = { GITHUB_TOKEN: "ghs_x", GITHUB_REPOSITORY: "acme/app" };

test("trackers criterion 3: the Jira adapter reads a repository_dispatch payload", () => {
  const jira = new JiraTracker(JIRA_ENV, DEFAULT_STATES.jira);
  const t = jira.ticketFromEvent({
    client_payload: { key: "MP-7", summary: "Recipe scaling", description: "Cook for more people.", url: "https://acme.atlassian.net/browse/MP-7" },
  });
  assert.deepEqual(t, { key: "MP-7", runId: "MP-7", title: "Recipe scaling", body: "Cook for more people.", url: "https://acme.atlassian.net/browse/MP-7" });
  assert.throws(() => jira.ticketFromEvent({ client_payload: { key: "mp-7; rm -rf" } }), TicketError);
  assert.throws(() => jira.ticketFromEvent({ issue: { number: 1 } }), TicketError);
});

test("trackers criterion 4: the GitHub adapter reads an issues event", () => {
  const gh = new GitHubTracker(GH_ENV, DEFAULT_STATES.github, "seula:ready-for-spec");
  const t = gh.ticketFromEvent({ issue: { number: 42, title: "Dark mode", body: null, html_url: "https://github.com/acme/app/issues/42" } });
  assert.deepEqual(t, { key: "42", runId: "GH-42", title: "Dark mode", body: "", url: "https://github.com/acme/app/issues/42" });
  assert.throws(() => gh.ticketFromEvent({ issue: { number: -1 } }), TicketError);
});

test("trackers criterion 2: a non-https link is dropped, and the ticket file names its source", () => {
  const jira = new JiraTracker(JIRA_ENV, DEFAULT_STATES.jira);
  const t = jira.ticketFromEvent({ client_payload: { key: "MP-8", summary: "X", description: "Y", url: "javascript:alert(1)" } });
  assert.equal(t.url, "");
  assert.equal(ticketMarkdown(t), "# MP-8: X\n\nSource: (no link)\n\nY\n");
});

test("trackers criterion 5: Jira comments go to the REST API with basic auth", async () => {
  const f = fakeFetch({ "POST /rest/api/2/issue/MP-7/comment": [201, {}] });
  await new JiraTracker(JIRA_ENV, DEFAULT_STATES.jira, f.impl).comment("MP-7", "Hello");
  assert.equal(f.calls[0]?.url, "https://acme.atlassian.net/rest/api/2/issue/MP-7/comment");
  assert.deepEqual(f.calls[0]?.body, { body: "Hello" });
  assert.equal(f.calls[0]?.headers.authorization, `Basic ${Buffer.from("me@acme.test:t0k3n").toString("base64")}`);
});

test("trackers criterion 6: Jira moves by the transition whose target status matches, ignoring case", async () => {
  const f = fakeFetch({
    "GET /rest/api/2/issue/MP-7/transitions": [200, { transitions: [{ id: "11", to: { name: "Done" } }, { id: "31", to: { name: "SPEC REVIEW" } }] }],
    "POST /rest/api/2/issue/MP-7/transitions": [204, null],
  });
  await new JiraTracker(JIRA_ENV, DEFAULT_STATES.jira, f.impl).move("MP-7", "specReview");
  assert.deepEqual(f.calls[1]?.body, { transition: { id: "31" } });
});

test("trackers edge case: no transition to the target status exits as an API error that names it", async () => {
  const f = fakeFetch({ "GET /rest/api/2/issue/MP-7/transitions": [200, { transitions: [] }] });
  await assert.rejects(new JiraTracker(JIRA_ENV, DEFAULT_STATES.jira, f.impl).move("MP-7", "needsInput"), (e) => {
    assert.ok(e instanceof TrackerApiError);
    assert.match(e.message, /"Needs input"/);
    return true;
  });
});

test("trackers criterion 6: GitHub swaps state labels and creates a missing label", async () => {
  const f = fakeFetch({
    "DELETE /issues/42/labels/seula%3Aneeds-input": [404, {}],
    "DELETE /issues/42/labels/seula%3Aready-for-spec": [200, []],
    "POST /app/labels": [201, {}],
    "POST /issues/42/labels": [200, []],
  });
  await new GitHubTracker(GH_ENV, DEFAULT_STATES.github, "seula:ready-for-spec", f.impl).move("42", "specReview");
  assert.deepEqual(
    f.calls.map((c) => `${c.method} ${c.url.replace("https://api.github.com/repos/acme/app", "")}`),
    ["DELETE /issues/42/labels/seula%3Aneeds-input", "DELETE /issues/42/labels/seula%3Aready-for-spec", "POST /labels", "POST /issues/42/labels"],
  );
  assert.deepEqual(f.calls[3]?.body, { labels: ["seula:spec-review"] });
  assert.equal(f.calls[0]?.headers["user-agent"], "seula");
});

test("trackers criterion 6: an existing label (422 on create) is fine", async () => {
  const f = fakeFetch({ "DELETE /issues/42/labels/seula%3Aspec-review": [404, {}], "DELETE /issues/42/labels/seula%3Aready-for-spec": [404, {}], "POST /app/labels": [422, {}], "POST /issues/42/labels": [200, []] });
  await new GitHubTracker(GH_ENV, DEFAULT_STATES.github, "seula:ready-for-spec", f.impl).move("42", "needsInput");
});

test("trackers criteria 8-9: credentials come from the environment; failures are API errors", async () => {
  await assert.rejects(new JiraTracker({}, DEFAULT_STATES.jira).comment("MP-7", "x"), TicketError);
  await assert.rejects(new JiraTracker({ ...JIRA_ENV, JIRA_BASE_URL: "http://acme.test" }, DEFAULT_STATES.jira).comment("MP-7", "x"), /https/);
  await assert.rejects(new GitHubTracker({ GITHUB_TOKEN: "x" }, DEFAULT_STATES.github, "l").comment("1", "x"), /GITHUB_REPOSITORY/);
  const f = fakeFetch({ "POST /issues/1/comments": [403, { message: "Resource not accessible" }] });
  await assert.rejects(new GitHubTracker(GH_ENV, DEFAULT_STATES.github, "l", f.impl).comment("1", "x"), (e) => {
    assert.ok(e instanceof TrackerApiError);
    assert.match(e.message, /HTTP 403: .*Resource not accessible/);
    return true;
  });
});

test("trackers criterion 7: configured state names replace the defaults", async () => {
  const cfg = config();
  cfg.tracker = { type: "jira", states: { specReview: "In review" }, triggerLabel: "x" };
  const f = fakeFetch({
    "GET /rest/api/2/issue/MP-1/transitions": [200, { transitions: [{ id: "5", to: { name: "In review" } }] }],
    "POST /rest/api/2/issue/MP-1/transitions": [204, null],
  });
  await makeTracker(cfg, "jira", JIRA_ENV, f.impl).move("MP-1", "specReview");
  assert.deepEqual(f.calls[1]?.body, { transition: { id: "5" } });
});
