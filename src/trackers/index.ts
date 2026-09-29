/** Picks the tracker adapter for a command (specs/trackers.md criterion 1). */
import { type SeulaConfig, type TrackerType, trackerStates } from "../config.ts";
import { GitHubTracker } from "./github.ts";
import { JiraTracker } from "./jira.ts";
import { TicketError, type Tracker } from "./types.ts";

/** The Jira or GitHub adapter, with the state names of that tracker. `env` and `fetchImpl` are for tests. */
export function makeTracker(config: SeulaConfig, type: TrackerType = config.tracker.type, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Tracker {
  const states = trackerStates({ ...config, tracker: { ...config.tracker, type } });
  if (type === "jira") return new JiraTracker(env, states, fetchImpl);
  if (type === "github") return new GitHubTracker(env, states, config.tracker.triggerLabel, fetchImpl);
  throw new TicketError(`Unknown tracker "${String(type)}". Use jira or github.`);
}
