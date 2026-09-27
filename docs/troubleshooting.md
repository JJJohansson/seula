# Troubleshooting the ticket-to-spec workflow

When a run of `ticket-to-spec.yml` goes wrong, seula names the step that failed. This page has
one entry for each step, under the step's name as GitHub Actions shows it. Find the step, then
follow its entry.

For setting seula up, see [Jira](setup-jira.md) or [GitHub Issues](setup-github-issues.md).

## Where to look

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
