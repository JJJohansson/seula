# Troubleshooting seula's workflows

When a run of `ticket-to-spec.yml` goes wrong, seula names the step that failed. This page has
one entry for each step, under the step's name as GitHub Actions shows it. Find the step, then
follow its entry. Board sync (`board-sync.yml`) and the plan step (`spec-to-plan.yml`) have
their own entries at the end: see [Board sync steps](#board-sync-steps) and
[Plan steps](#plan-steps).

For setting seula up, see [Jira](setup-jira.md) or [GitHub Issues](setup-github-issues.md).

## Where to look

These places are for ticket-to-spec, and for the plan step, which reports in the same way. Board
sync never comments on the ticket.

1. **The ticket.** A technical failure posts one comment that starts with "seula failed to
   run". It names the step that failed, or why Claude stopped, and links the run. The ticket
   stays in its column.
2. **The top of the Actions run.** The same reason is an error on the run. It is there also
   when seula couldn't post on the ticket: before the ticket was read, or when the tracker
   refused seula's credential.
3. **The run's job summary.** It repeats the reason and shows `seula status`.
4. **The step's log.** It has the details: the HTTP status, the command's own message.

A refused credential (HTTP 401 or 403) is named in all of these, by the secret's name in the
workflow and in the repository. A secret's value is never written. seula's commands exit 77 for
a refused credential and 70 for other errors (see
[quality gates](quality-gates.md#exit-codes)).

## Moving a ticket starts no run

seula can't report this, because no run starts.

- **Jira:** open the automation rule's audit log. A 401 means GitHub refused the dispatch token:
  it is wrong or expired. A 404 means a wrong repository in the URL, or a token without access
  to it or without Contents write. A 204 with no run means the caller workflow isn't on the default branch, or
  `event_type` isn't `seula-ticket`.
- **GitHub Issues:** check that the caller workflow is on the default branch and that the label
  is the configured `triggerLabel`.

## Anthropic credit has run out

Anthropic answers with an API error, not a refused key. The ticket gets "seula failed to run"
with "Claude stopped with an API error", and the log of "Write the spec" shows the message.
G0 still works, because it runs before Claude. Check the credit balance in the Anthropic
Console. The ticket stays in its trigger column: move it out and back to start seula again.

## Steps

### Check the inputs

**What it does:** checks the caller workflow's inputs: `tracker`, `model`, `base-branch` and
`sdd-skill-repo`.

**When it fails:** an error names the input. The ticket gets no comment, because it isn't read
yet.

**What to check:** the `with:` block of the caller workflow.

### Check out the repo

**What it does:** checks out the repository with `SEULA_GH_TOKEN`.

**When it fails:** an error on the run says that the step's only credential is
`SEULA_GH_TOKEN`. The ticket gets no comment, because it isn't read yet.

**What to check:** that the `SEULA_GH_TOKEN` secret exists, isn't expired, and has Contents
access to the repository.

### Check out seula

**What it does:** checks out seula at the `seula-ref` of the caller workflow.

**When it fails:** the ticket gets no comment, because it isn't read yet.

**What to check:** that `seula-ref` exists in the seula repository, and that the repository is
reachable: public, or shared in its Actions settings.

### Read the ticket (criterion 2)

**What it does:** reads the ticket from the event and writes the ticket file.

**When it fails:** an error names an invalid ticket id or an invalid directory in
`seula.config.json`. The ticket gets no comment.

**What to check:** the automation rule's body (Jira) or the event (GitHub Issues), and the
directories in `seula.config.json`.

### Read the ticket's comments (criterion 18)

**What it does:** adds the ticket's comments to the ticket file.

**When it fails:** a refused credential names `JIRA_EMAIL` and `JIRA_API_TOKEN`, or
`SEULA_GH_TOKEN`. Then the failure comment can't be posted either, so the reason is only on
the run.

**What to check:** the tracker secrets, and the HTTP status in the step's log.

### G0 · is the ticket ready? (criterion 3)

**What it does:** checks the ticket with a script, then with Jev.

**When it fails:** "seula failed to run" names this step. A refused key names
`TYPESAFE_API_KEY` (the repository secret `SEULA_TYPESAFE_API_KEY`). A ticket that isn't ready
is not a failure: it goes to Needs input with G0's questions.

**What to check:** the Jev key, and the step's log for the HTTP status.

### Ask on the ticket (G0 did not pass)

**What it does:** posts G0's questions on the ticket and moves it to Needs input.

**When it fails:** a refused credential names the tracker secrets, as in "Read the ticket's
comments". When only the move fails, the step warns and the ticket keeps its column.

**What to check:** the tracker secrets; for a move, that the status exists, is reachable from
the current one, and matches `tracker.states`.

### Find an earlier run for this ticket (criterion 16)

**What it does:** finds the ticket's open pull request, and an earlier draft spec on its branch.

**When it fails:** "seula failed to run" names this step.

**What to check:** that `SEULA_GH_TOKEN` can read pull requests and contents.

### Install Claude Code

**What it does:** installs the sandbox (bubblewrap) and a pinned Claude Code, and checks that
the sandbox starts.

**When it fails:** "seula failed to run" names this step. The log may say that bubblewrap
can't create a sandbox on this runner.

**What to check:** a change of the runner image (`ubuntu-latest`), or a package mirror outage:
run the workflow again. With `sdd-skill-repo`, that the skill's repository is reachable.

### Write the spec · Claude with G1 in the loop (criteria 4-5, 10)

**What it does:** Claude writes or updates one spec, with the format check in its loop.

**When it fails:** this step doesn't fail by itself; "Read the result" judges Claude's output.
The failure comment then says that Claude reached its turn limit, that Anthropic refused
`ANTHROPIC_API_KEY` (the repository secret `SEULA_ANTHROPIC_API_KEY`), that Claude stopped with
an API error, or that it stopped with another error.

**What to check:** the Anthropic key and credit (see above). The step's log shows Claude's
summary: `is_error`, the turns and the cost.

### G1 · the workflow's own check (criteria 8, 15)

**What it does:** runs G1 with Jev on the spec that Claude returned.

**When it fails:** it never fails the run. When G1 can't run, the step warns and the pull
request stays a draft. A refused key is named in the warning.

**What to check:** the warning in the step's log, and the Jev key.

### Read the result (criteria 8, 11)

**What it does:** stores Claude's cost and decides the outcome: ready, review, needs input or
failed.

**When it fails:** "The agent returned no valid spec file" means Claude wrote no spec in the
spec directory. A failure of the step itself is named like any other step.

**What to check:** the step's errors and warnings: Claude's exit code and error kind, or the
spec path that Claude returned.

### Check the agent's output for secrets (criterion 13)

**What it does:** looks for the value of each secret in the spec directory, the run file and
Claude's output.

**When it fails:** an error names the secret, never its value. Nothing is committed or posted,
except the failure comment.

**What to check:** what the agent wrote. Then replace the secret: treat it as exposed.

### Commit and open the pull request (criterion 7)

**What it does:** commits the spec, the ticket file and the run file, pushes the branch, and
opens or updates the pull request.

**When it fails:** "seula failed to run" names this step.

**What to check:** that `SEULA_GH_TOKEN` can write contents and pull requests, and that no
branch rule blocks `seula/` branches.

### Report on the ticket (criterion 9)

**What it does:** posts the pull request's link on the ticket and moves it to Spec review or
Needs input.

**When it fails:** it only warns: the pull request stays, and the ticket may keep its column.

**What to check:** the tracker secrets, and the status names in `tracker.states`.

### Report a failure on the ticket (criterion 17)

**What it does:** after a technical failure, writes the reason on the run and in the job
summary, and posts "seula failed to run" on the ticket.

**When it fails:** when the comment can't be posted, it warns. The reason is still on the run.

**What to check:** the error at the top of the run.

### Summary

**What it does:** writes `seula status` into the job summary.

**When it fails:** it fails on purpose when the run failed or the spec run is blocked, so the
run shows red.

**What to check:** the steps before it. Blocked means G1's loop limit: see the ticket.

## Board sync steps

`board-sync.yml` runs on the pull requests of `seula/` branches. Its "ticket state" job is the
check `seula / ticket state` on the spec pull request. Its "move on merge" job runs when the
spec pull request is merged. It never comments on the ticket. Look at the check on the pull
request, the run's job summary, and the step's log. Both jobs are skipped for other branches and
for forks: that is not an error.

### Check out the config

**What it does:** checks out only `seula.config.json`, from the pull request's base commit, so
the pull request can't change the state names it is checked against.

**When it fails:** the job fails before seula runs. A missing `seula.config.json` is not a
failure: seula then uses its defaults, and the move to Planning is skipped.

**What to check:** that the base branch still exists, and that the caller workflow grants
`contents: read`.

### Check out seula

**What it does:** checks out seula at the `seula-ref` of the caller workflow.

**When it fails:** the job fails before seula runs.

**What to check:** that `seula-ref` exists in the seula repository, and that the repository is
reachable: public, or shared in its Actions settings.

### Check the ticket state (criterion 4)

**What it does:** takes the ticket key from the branch name and reads the ticket's state. It
fails while the ticket is in *Needs input*, so a repo that requires the check can't merge.

**When it fails:**
- "… needs input. Answer the questions on the ticket first, then re-run this check." This is
  the check working. Answer on the ticket and move it to *Ready for spec*. The next seula run
  pushes to the pull request, and the check runs again. After a move by hand, re-run the check
  from the pull request page.
- Exit 64: the branch name gives no ticket key, for example `seula/notes`. seula calls no
  tracker.
- Exit 77: the tracker refused the credential. The log names it: `JIRA_EMAIL` and
  `JIRA_API_TOKEN` for Jira, `GITHUB_TOKEN` for GitHub Issues.
- Exit 70: another tracker error. The log has the HTTP status.

**What to check:** for 77, the Jira secrets passed by the caller workflow, or for GitHub Issues
that the caller grants `issues: write`. For a check that stays red after the ticket moved:
re-run it, because a move in the tracker doesn't start the check.

### Move the ticket to Planning (criterion 5)

**What it does:** after a merge, moves the ticket to Planning, whatever state it is in. The job
summary shows the result.

**When it fails:**
- "Moved nothing: tracker.states.planning is not set" is not a failure. Set it to turn the move
  on.
- Exit 70 with "No Jira transition to …": the Jira workflow has no transition to the Planning
  status from the ticket's status.
- Exit 77 or 64: as for the ticket state check.

**What to check:** the status or label name in `tracker.states.planning`, and in Jira that every
status can move to Planning.

## Plan steps

`spec-to-plan.yml` runs when a pull request is closed. Its job runs only when a spec pull request
from a `seula/` branch in the same repo was merged; for every other pull request it is skipped,
and that is not an error. It marks the spec *Approved*, lets Claude write the plan into the
spec's `## PLAN` section, and opens a plan pull request on a `seula-plan/` branch. A technical
failure posts "seula failed to run" on the ticket, as ticket-to-spec does. The ticket's state
never changes.

### Check the inputs

**What it does:** checks the caller workflow's inputs: `tracker`, `model` and `base-branch`.

**When it fails:** an error on the run names the input. The ticket gets no comment, because its
key isn't known yet.

**What to check:** the `with:` block of the caller workflow.

### Check out the repo

**What it does:** checks out the repository at `base-branch`, after the merge, with
`SEULA_GH_TOKEN`.

**When it fails:** the error on the run says that the step's only credential is
`SEULA_GH_TOKEN`. The ticket gets no comment.

**What to check:** that the `SEULA_GH_TOKEN` secret exists, isn't expired, and has Contents
access to the repository.

### Check out seula

**What it does:** checks out seula at the `seula-ref` of the caller workflow.

**When it fails:** the ticket gets no comment.

**What to check:** that `seula-ref` exists in the seula repository, and that the repository is
reachable: public, or shared in its Actions settings.

### Find the ticket and the spec (criteria 2-3)

**What it does:** takes the ticket key from the branch name, and finds the one spec that the
merged pull request added or changed. Files in the config's `ignore` list, such as the spec
index, don't count.

**When it fails:**
- "The merged pull request changed 0 specs" or "changed 2 specs": the plan step needs exactly
  one. A pull request that changes no spec, or several, gets no plan.
- GitHub refused `SEULA_GH_TOKEN` when the step read the pull request's files: the failure
  report names the secret.

**What to check:** that one spec pull request changes one spec; the config's `specDir` and
`ignore`; the `SEULA_GH_TOKEN` secret.

### Keep the approved copy, then approve the spec (criteria 4-5)

**What it does:** keeps a copy of the spec as merged in `.seula/approved/`, for G2 to compare
with, then marks the spec *Approved* with `seula approve`.

**When it fails:** exit 64. The spec has no status line, or `Approved` is not one of the
config's `statuses`.

**What to check:** the spec's `> **Status:** …` line, and `statuses` in the config.

### Install Claude Code

**What it does:** installs the agent's sandbox (bubblewrap) and Claude Code at a pinned version.

**When it fails:** an error on the run, and a "seula failed to run" comment that names the step.

**What to check:** the step's log. A failed package download usually passes on a re-run.

### Write the plan · Claude with G2 in the loop (criteria 5-6)

**What it does:** Claude reads the code, writes the spec's `## PLAN` section, and runs G2 on it
until it passes, is unsure, or reaches the loop limit. It can edit only this spec and run only
G2.

**When it fails:** the failure comment gives the reason: Claude reached its turn limit, Anthropic
refused the key, Claude stopped with an API error, or the agent returned another spec than the
approved one.

**What to check:** for a refused key, `SEULA_ANTHROPIC_API_KEY`; for credit, see
[Anthropic credit has run out](#anthropic-credit-has-run-out); for a turn limit, whether the spec
is very large.

### G2 · the workflow's own check (criterion 7)

**What it does:** runs G2 again with the Jev key, so the flag questions are asked, and records
the result in the run file.

**When it fails:** a refused Jev key is a warning, not a failure. The plan pull request then
stays a draft, because the plan wasn't checked.

**What to check:** the `SEULA_TYPESAFE_API_KEY` secret.

### Read the result (criteria 10, 13)

**What it does:** stores the Claude cost in the run file, and decides the plan pull request's
state from the last G2 result: ready, review (flags), draft, or blocked.

**When it fails:** rarely; the log has the details.

**What to check:** that the run file in `.seula/runs/` is valid JSON.

### Check the agent's output for secrets (criterion 8)

**What it does:** looks for the value of every secret in the spec, the run file and the agent's
output, before anything is committed or posted.

**When it fails:** an error names the secret whose value appears, never the value. Nothing is
committed or posted.

**What to check:** replace the named secret, because its value may have leaked into the run's
files. Then look at the spec for text that shouldn't be there.

### Commit and open the plan pull request (criterion 9)

**What it does:** commits the spec and the run file to `seula-plan/<ticket>`, and opens the plan
pull request, or updates the ticket's open one.

**When it fails:** the failure comment names the step.

**What to check:** that `SEULA_GH_TOKEN` has Contents and Pull requests write access, and that
no branch rule blocks `seula-plan/` branches.

### Report on the ticket (criterion 11)

**What it does:** comments on the ticket with the plan pull request's link, and the flags or
open questions. It doesn't move the ticket.

**When it fails:** a warning; the plan pull request is still there.

**What to check:** the tracker credentials (the Jira secrets, or `SEULA_GH_TOKEN` for GitHub
Issues).

### Report a failure on the ticket (criterion 12)

**What it does:** after a technical failure, writes the reason on the run and in the job
summary, and posts "seula failed to run" on the ticket.

**When it fails:** when the comment can't be posted, it warns. The reason is still on the run.

**What to check:** the error at the top of the run.

### Summary

**What it does:** writes `seula status` into the job summary.

**When it fails:** it fails on purpose when the run failed, or when the plan is blocked by G2's
loop limit, so the run shows red.

**What to check:** the steps before it, and the draft plan pull request for a blocked plan.
