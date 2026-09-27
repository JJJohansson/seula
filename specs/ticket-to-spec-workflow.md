# FEATURE: Reusable ticket-to-spec and spec-check workflows

> **Status:** Approved (26 Sep 2026). Criteria 17–19 and the cost breakdown in criterion 11 approved and built 27 Sep 2026. **Change B (rounds): the changes to criteria 3, 8 and 16, and criteria 20–26, drafted 27 Sep 2026, not approved. Credential errors: the change to criterion 17 and criteria 27–28 drafted 27 Sep 2026, not approved.**

## OVERVIEW
Two reusable GitHub Actions workflows in the seula repo. **ticket-to-spec** turns a tracker
ticket into a spec pull request: it checks the ticket (G0), lets Claude write or update the spec
with G1 in its loop, opens a pull request, and reports back on the ticket. **spec-check** runs
seula's G1 format rules on the specs that a pull request changes. A repo uses them through a
short caller workflow (see [`adoption.md`](adoption.md)).

## WHY / INTENT
The logic lives in one place, so every repo that adopts seula gets fixes and improvements by
changing one `ref`, instead of carrying its own copy that drifts. Drafting a spec is automated;
approving it and merging stay with a person.

## INPUTS / OUTPUTS
- Inputs (`workflow_call`): `tracker` (`jira` | `github`), `seula-ref` (default `main`), `model`
  (default `opus`), `base-branch` (default `main`). Secrets: `ANTHROPIC_API_KEY`,
  `SEULA_GH_TOKEN`, optional `TYPESAFE_API_KEY`, and for Jira `JIRA_BASE_URL`, `JIRA_EMAIL`,
  `JIRA_API_TOKEN`. The caller maps the repo's secrets onto these names (see
  [`adoption.md`](adoption.md), criterion 3).
- Outputs: a branch `seula/<ticket key>` (criterion 16) with the spec change, the ticket file
  (the description and the comments) and the run file; a pull request; a comment and a state
  change on the ticket.

## ACCEPTANCE CRITERIA
1. `ticket-to-spec.yml` runs on `workflow_call` with the inputs and secrets above, and checks
   out the calling repo and seula at `seula-ref`.
2. It reads the ticket with `seula tracker ticket` from the event file. An invalid ticket stops
   the run before any other step.
3. It runs G0 on the ticket file. When G0 returns back or unsure, it posts G0's asks and notes
   on the ticket, sets the ticket to `needsInput`, and writes no spec. When the ticket has an
   open pull request that is ready for review, the workflow also marks it as a draft, so the
   pull request and the ticket agree. It commits nothing.
4. When G0 passes or is skipped, Claude writes or updates one spec in the repo's configured
   spec directory with the spec-writer prompt and the seula plugin, and runs G1 until G1 passes,
   is unsure, or reaches the loop limit.
5. The agent can edit only files in the spec directory and read only files in the working
   directory and its installed skills. It can't run git or fetch web pages. Its only shell
   command is seula's G1 gate, and its shell commands can't see the Anthropic key. The agent
   gets no Jev key: its G1 checks the format only (criterion 15).
6. No ticket field appears in a `run:` script: ticket text reaches the gates and the agent only
   as a file. Each secret is given only to the steps that use it. No credential is stored on
   disk while the agent runs.
7. The workflow commits the spec, the ticket file and the run file to the branch, and opens a
   pull request (or updates the existing one) that links the ticket, lists every gate result and
   its feedback, and states which checks ran.
8. The pull request is ready for review only when the agent has no open questions and the last
   G1 result of the current round (criterion 22) is pass, skipped because no Jev key is configured, or unsure (review),
   whatever the agent reports; otherwise it is a draft. When G1 is unsure, the pull request
   lists the unsure criteria under "Needs your judgement". A pull request that a later run
   updates follows that run's result.
9. After the pull request opens, the workflow posts its link on the ticket and sets the ticket
   to `specReview` when the pull request is ready for review (with the unsure criteria, if
   any), or to `needsInput` with the agent's open questions and G1's feedback when not.
10. The workflow never sets a spec to a buildable status; a new spec gets the first
    non-buildable status in the config (`Idea` by default).
11. The Claude cost of the run is added to the run file, with its breakdown: turns, duration,
    and tokens and cost per model ([`run-files.md`](run-files.md) criterion 10).
12. `spec-check.yml` runs on `workflow_call`, finds the spec files that the pull request adds
    or changes, and runs `seula check-spec` on them, skipping the config's `ignore` list. The
    check fails when a spec has a format error.
13. Before it commits or posts anything, the workflow checks the files and the agent's output
    for the value of each secret it holds, and stops the run when it finds one.
14. The agent's permissions, hooks and tools come only from the workflow. The adopting repo's
    Claude Code configuration (`.claude/settings.json`, `.claude/settings.local.json`,
    `.mcp.json`, its project skills and subagents) does not change them, and none of its hooks
    run.
15. After the agent finishes, the workflow runs G1 with the Jev key on the spec that the agent
    returned and records the result in the run file. That is the last G1 result for
    criterion 8. When it sends the spec back or is unsure, its feedback goes on the ticket as
    well as in the pull request.
16. Every run for the same ticket uses one branch and one pull request: the ticket's open
    pull request branch if it has one, else `seula/<ticket key>`. When the ticket has an open
    pull request and an earlier run added a spec on its branch that is not on the base branch,
    the agent gets that spec and is told to update it, not to write another. A
    `seula/<ticket key>` branch without an open pull request (closed or merged) is not read:
    the run starts from the base branch and replaces that branch. If the agent still returns another file, the earlier
    draft is removed, so the pull request holds one spec for the ticket.
17. A technical failure is not a result about the ticket. A technical failure is a step that
    fails or is cancelled (a timeout included), Claude exiting with an error (the turn cap
    included), or the agent returning no valid spec path. The workflow then doesn't change the
    ticket's state, and posts one comment on the ticket: "seula failed to run", the link to the
    workflow run, why it failed, and how to start it again. Why it failed is the name of the
    first step that failed, or for a Claude error its kind: the turn cap, a refused key
    (criterion 27), another API error, or another error. The comment holds only fixed text, the step's name and the link, never the
    agent's output (criterion 13). The run fails visibly in Actions. When
    Claude exits with an error or returns no valid spec path, no pull request is opened, even
    if the agent wrote a file. The agent's own `blocked` (G1's loop limit) is a result, not a
    failure: it stays with criteria 8 and 9.
18. After it reads the ticket and before G0, the workflow adds the ticket's comments to the
    ticket file with `seula tracker comments` ([`trackers.md`](trackers.md) criteria 10–13).
    G0 and the agent read the description and the comments as one ticket. Only this step and
    the steps that post on the ticket get the tracker's credentials. When the comments can't be
    read, the run is a technical failure (criterion 17).
19. seula's comments on a ticket describe what happened and what a person can do next. They
    never address an agent or an automated system, and never tell anyone to run a command. A
    comment that asks for input (criteria 3 and 9) ends with one line: the ticket's author can
    answer in a comment, then start seula again.
20. Each run for a ticket is one round. Before G0, the workflow looks for the ticket's run
    file: on the branch of the ticket's open pull request (criterion 16) when there is one,
    else on the base branch (a spec pull request for the ticket was merged earlier). When it
    finds one, the run continues it and starts a new round in it
    ([`run-files.md`](run-files.md) criterion 11). The earlier rounds' events, links and cost
    stay in the file. When it finds none, the run starts a new run file at round 1.
21. The workflow continues a run file only when it is valid JSON, has the ticket's run id,
    and has a round that is a whole number of 1 or more. Otherwise the run replaces it with a
    new run file at round 1 and logs a warning.
22. Every decision in a round reads only that round's events: the last G1 result (criteria 8
    and 15), the unsure criteria under "Needs your judgement", the feedback on the ticket
    (criterion 9) and the loop limit ([`run-files.md`](run-files.md) criterion 5). When the
    current round has no G1 event, its last G1 result is none, and the pull request is a draft.
23. The workflow doesn't start a new round when nothing is new. Nothing is new when all of
    these are true: the ticket has an open pull request with a valid run file (criteria 20–21);
    the last round in that file has a G1 result of pass, back or unsure; and the ticket's
    description and its comments that are not labelled `seula` ([`trackers.md`](trackers.md)
    criterion 11) are the same as in the ticket file on that branch. Then the workflow runs
    neither G0 nor Claude and commits nothing. It posts one comment: nothing changed on the
    ticket since round N, the link to the pull request, and that the ticket's author can add a
    comment with what changed, then start seula again. It sets the ticket to `specReview` when
    the pull request is ready for review, and to `needsInput` when it is a draft.
24. `roundWarning` in `seula.config.json` is a whole number, default 3; 0 turns the warning
    off. From round `roundWarning` on, the comment of criterion 9 has one more line: the round
    number, and that each round runs Claude again. The warning never stops a run and never
    changes the ticket's state.
25. The pull request shows the round number and the current round's gate results. It lists
    the earlier rounds' gate results under "Earlier rounds (restored from the branch)". Its
    cost line gives the total over all rounds and, next to it, the current round's Claude cost.
26. Before it commits the run file, the workflow sets the run file's step and waiting-on to the
    state that the round gives the ticket (criterion 9), with `seula update --state`
    ([`run-files.md`](run-files.md) criterion 13). `seula status` then shows the same next
    action as the board.
27. When a service refuses a credential, the reason in criterion 17 names that credential.
    A refused credential is a seula command that exits 77 ([`trackers.md`](trackers.md)
    criterion 9, [`g1-spec-gate.md`](g1-spec-gate.md) criterion 17), or a Claude API error
    with HTTP status 401 or 403. The reason names the secret twice: by the name the reusable
    workflow receives it under, and by the repository secret name that `seula init` prints
    for it ([`adoption.md`](adoption.md) criterion 9). It says that the credential may be
    expired or revoked, and that a repository admin can replace the secret. When the check out
    of the repo fails, the reason names that step and says that its only credential is
    `SEULA_GH_TOKEN`. Only a secret's name is written, never its value.
28. The failure report writes the reason as an error on the workflow run and in the run's job
    summary. It does this also when it can't post on the ticket: when there is no ticket key
    yet, or when the tracker refused the credential.

## OUT OF SCOPE
- Building the feature from an approved spec.
- Merging anything automatically.
- Gates G2 to G5.
- A hard stop after a number of rounds. The round warning (criterion 24) only informs.
- Recording rounds that don't reach the pull request (a G0 back or a technical failure).
- Updating a spec that is already on the base branch. The agent isn't told about a merged
  spec, so a run after the merge can write a second spec for the ticket.

## EDGE CASES
- The same ticket triggers again after `needsInput`: the branch is regenerated from the base
  branch, the earlier draft spec is carried over (criterion 16), and the existing pull
  request's description is updated.
- The agent returns no valid spec path: a technical failure (criterion 17).
- The ticket can't be read, or seula itself can't be checked out: the run fails visibly in
  Actions, and the ticket gets no comment, because there is no ticket key or no seula to post
  it with.
- The secret check stops the run (criterion 13): the failure comment still goes on the ticket,
  because it holds no agent output.
- The failure comment itself can't be posted (for example an expired tracker token): the run
  logs a warning; the run's own failure is still visible in Actions.
- Claude's output has no cost breakdown (an older Claude Code, or a crash): the total cost is
  stored when there is one, and the breakdown is left out. The run doesn't fail for it.
- No `TYPESAFE_API_KEY`: Jev checks are recorded as skipped; the format checks still run.
- A tracker call fails after the pull request opened: the run logs a warning and keeps the
  pull request.
- G0 sends back, or the run fails (criterion 17), on a ticket with an open pull request: the
  round commits nothing, so the next round restores the last committed round. Only rounds
  that reach the pull request are counted. After a G0 back the pull request is a draft
  (criterion 3). The ticket text that caused the back still differs from the last committed
  round, so criterion 23 never skips the next round.
- The ticket moves to Ready for spec again after its spec pull request was merged: the run
  continues the run file on the base branch in a new round (criterion 20). The merged
  round's results never decide anything (criterion 22).
- The last round's G1 couldn't run (no G1 result, or skipped with a Jev key configured): a
  retry is never "nothing new" (criterion 23), so the round runs.
- A person's comment that starts with `seula · ` is labelled `seula` and doesn't count as new
  for criterion 23. The comment of criterion 23 tells the author to add a comment, so a second
  comment starts the round.
- The restored run file comes from a branch that anyone with push access can change. Earlier
  rounds' results are shown as restored and never decide anything (criterion 22).
- Jev refuses its key in the workflow's own G1 (criterion 15) but not in G0 of the same run:
  G1 couldn't run, so the pull request stays a draft (criterion 8). The warning names
  `TYPESAFE_API_KEY` (criterion 27).
- Several credentials expire together: the first step that uses one fails, and the reason
  names only that credential.
- A run file written before rounds existed is round 1 ([`run-files.md`](run-files.md)
  criterion 12).

## PLAN
1. Move the drafted workflow into seula as `.github/workflows/ticket-to-spec.yml`
   (`workflow_call`), replacing Jira-specific steps with `seula tracker` commands.
2. `.github/workflows/spec-check.yml` (`workflow_call`).
3. Make the spec-writer prompt repo-agnostic: read `CLAUDE.md` or `AGENTS.md` and
   `SPEC_DRIVEN_DEVELOPMENT.md` when present, else use the template named in the config.
4. Validate: YAML parses; every shell step passes `bash -n`; no `${{ }}` inside `run:`; then one
   real run on a test repo per tracker.
5. Criteria 5, 6, 8 and 13 (tightened 26 Sep 2026): `test/workflows.test.ts` checks the workflow
   file, and runs the secret check with bash. The first real run must also show that the G1
   events in the run file have Jev results, not `skipped`: the subprocess scrub must leave
   `TYPESAFE_API_KEY` to the G1 command. If it doesn't, criterion 8 opens a draft, not a ready
   pull request.
6. First real run (2026-09-27, MEAL-1 in mealPlanner): the dispatch, G0, the ticket file and the
   Jira comment and move worked. Claude Code refused to start: with the subprocess scrub it
   needs bubblewrap, which the runner lacks. The workflow now installs bubblewrap and socat,
   adds the documented AppArmor profile for `bwrap` on Ubuntu 24.04, self-tests the sandbox, and
   lets the sandboxed G1 reach only the Jev host from the config.
7. Second real run (2026-09-27, MEAL-1): end to end, a draft pull request and the agent's
   questions on the ticket (19 turns, $0.89). The scrub also removed `TYPESAFE_API_KEY` from
   the agent's G1, so Jev was skipped and criterion 8 kept the pull request a draft. The
   workflow now masks the Jev key for sandboxed commands (TLS-terminating proxy, the real key
   injected only toward the Jev host) and sets `NODE_USE_ENV_PROXY=1` so Node's fetch uses
   the sandbox proxy.
8. Third real run (2026-09-27, MEAL-1): the retry updated the same pull request. Masking failed
   closed: Claude Code 2.1.274 reported TLS termination as unavailable, so the agent's G1 sent
   the placeholder and Jev answered 401. Masking is dropped: the agent gets no Jev key, and
   the workflow runs G1 with Jev itself after the agent (criterion 15). The agent no longer
   reworks criteria on Jev feedback; a person answers it on the ticket and moves it back.
9. Fifth real run (2026-09-27, MEAL-1): after the ticket was clarified, the agent had no
   questions and G1 passed 10 criteria and was unsure about 2. The ticket still went to
   `needsInput`, asking its author to judge criteria. Criteria 8 and 9 now send unsure-only
   results to spec review, and an updated pull request leaves or enters draft with the result.
   The rehearsal (MEAL-3) then moved a ticket to `specReview` automatically for the first time.
   It also showed that a retry of a ticket with a **new** spec started from the base branch,
   didn't see its own draft, wrote another spec with another name, and opened a second pull
   request (the branch name included the spec's name). Criterion 16 fixes that: one branch per
   ticket, and the earlier draft goes to the agent.
10. Criterion 14 (added 26 Sep 2026): the agent runs with `--setting-sources user`. Under `-p`,
   Claude Code ignores a project's allow rules, but it still runs the project's hooks, applies
   its `env` block, connects its `.mcp.json` servers, and honors a project skill's
   `allowed-tools`. Leaving out the project and local sources stops all of these. The agent
   still gets the seula plugin (`--plugin-dir`) and the skills installed in
   `~/.claude/skills`. It doesn't get the repo's `CLAUDE.md` automatically (the prompt tells it
   to read that file), `.claude/rules`, or the repo's own `.claude/skills`; a repo gives the
   agent its spec-driven-development skill with the `sdd-skill-repo` input.
   `test/workflows.test.ts` checks the flag.
11. Criterion 17 (added 27 Sep 2026): the first real run (plan step 6) failed because Claude
   Code couldn't start, but the workflow reported it as the ticket needing input: the ticket
   moved to Needs input with "the spec needs input (blocked). Draft pull request: none", which
   told its author nothing they could fix. A step that failed outright (for example the sandbox
   self-test) was the opposite: every later step was skipped and the ticket got nothing. Both
   now post "seula failed to run" with the run link and leave the ticket where it is.
12. Criteria 18–19 and the reason in criterion 17 (added 27 Sep 2026). Answers written as
   comments never reached the agent (see [`trackers.md`](trackers.md), plan step 4). The
   comments now go into the ticket file. G0 reads them too: an answer to G0's own question must
   be able to make the ticket pass. Because G0 now reads seula's comments, those comments are
   written so that G0's check for text aimed at the agent has nothing to find in them
   (criterion 19). The failure comment names the failed step, so a person sees the reason
   without opening the log. The failure step reads each step's outcome
   (`steps.<id>.outcome`) and names the first step that failed or was cancelled. The Claude
   error kind comes from a fixed list; Claude's own error text is never posted. The field names of Claude Code's JSON output (`num_turns`, `duration_ms`,
   `modelUsage`) are checked in the first real run after this change.
