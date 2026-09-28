# FEATURE: Run files and status

> **Status: Active.** Written after the first implementation (26 Sep 2026); confirm the criteria. Criterion 10 approved and built 27 Sep 2026. **Change B (rounds): the changes to criteria 1, 5, 9 and 10, and criteria 11–13, drafted 27 Sep 2026, not approved.** **Plan step: the change to criterion 3 (after G2, a person reviews the plan) drafted 28 Sep 2026, not approved** (see [`spec-to-plan-workflow.md`](spec-to-plan-workflow.md)).

## OVERVIEW
Every gate result for a feature is appended to one JSON file, and `seula status` shows where
each feature is and who it waits on.

## WHY / INTENT
The gate history should travel with the change so that it can be reviewed, and a person should
see at a glance which features wait for their decision.

## INPUTS / OUTPUTS
- Inputs: `--run <id>` on gate commands; `seula update`; `seula status`.
- Outputs: `.seula/runs/<id>.json` (directory configurable as `runsDir`); a status table or JSON.

## DATA SCHEMA
- `id`, `title`, `spec`, `round`, `step`, `waitingOn` (`agent` | `human` | `none`), `blocked`
  (optional reason), `events[]` (`gate`, `result`, `at`, `round`, `attempt`, `summary`,
  `feedback[]`, `costUsd`),
  `links` (`ticket`, `pr`), `cost` (`claudeUsd`, `jevUsd`, `claudeRuns[]`), `updatedAt`.
- `claudeRuns[]`: `at`, `round`, `usd`, `turns`, `durationMs`, `models` (per model name:
  `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `usd`). Each field is
  present only when Claude's output had it.

## ACCEPTANCE CRITERIA
1. A gate command with `--run <id>` appends one event that records the gate, the result, the
   time, the round, the attempt number (1 for the first event of that gate in the round), the
   summary, the feedback lines and the Jev cost.
2. A run id may contain only letters, digits, `.`, `_` and `-`. Any other id is rejected before a
   file is written.
3. After a pass or a skip, `step` and `waitingOn` become: after G0, spec (agent); after G1, spec
   review (human); after G2, plan review (human); after G3, verify (agent); after G4, merge (human);
   after G5, done (none).
4. After a back, the run waits on the agent, except after a G0 back, when it waits on a person.
   After an unsure result, the run waits on a person.
5. When one gate has sent the feature back more than `maxBacks` times (default 2) in the
   current round, the run is marked blocked, waits on a person, and the gate command exits 3.
   A later pass of that gate removes the block.
6. The Jev cost of each event is added to `cost.jevUsd`.
7. `seula update --run <id>` adds `--claude-usd` to `cost.claudeUsd` and stores `--ticket-url`
   and `--pr-url`. It rejects a negative cost and any link that does not start with `https:`.
8. `seula status` lists runs newest first, with id, title, step, gate history (✓ pass, ↺ back,
   ? unsure, ✗ fail, – skipped) and next action, under a first line that counts the runs waiting
   on a person.
9. The next action reads "approve spec" when the step is spec review, "merge" after a G4 pass,
   "answer the ticket questions" when the step is input and the run waits on a person, and
   "loop limit reached" when the run is blocked.
10. `seula update --run <id> --claude-result <file>` reads Claude Code's JSON output, adds its
    total cost to `cost.claudeUsd`, and appends one entry to `cost.claudeRuns` with the round,
    the turns, the duration, and the tokens and cost per model. It stores only numbers and
    model names:
    a value that is not a finite, non-negative number is left out, and a model name that
    contains anything other than letters, digits, `.`, `_`, `-` or `[`, `]` is left out.
    Claude's text output is never stored.
11. A new run file starts at round 1. `seula update --run <id> --new-round` adds 1 to `round`,
    sets `step` to `input` and `waitingOn` to `agent`, and removes `blocked`. The events, the
    links and the cost stay.
12. A run file without `round` is read as round 1. An event or a Claude run without `round`
    belongs to round 1.
13. `seula update --run <id> --state <needsInput|specReview>` sets the run to the ticket's
    state: `needsInput` sets `step` to `input`, `specReview` sets it to `spec review`, and both
    set `waitingOn` to `human`. `blocked` stays. Any other state is rejected.

## OUT OF SCOPE
- A web dashboard (see [`dashboard.md`](dashboard.md)).
- Deleting or archiving runs.

## EDGE CASES
- No runs directory: `status` says that there are no runs yet.
- `update` for an id without a run file exits 70 with an error.
- `--claude-result` names a file that is missing or not JSON: `update` stores nothing from it,
  warns, and still applies its other options.
