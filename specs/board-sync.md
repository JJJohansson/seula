# FEATURE: Board sync (the ticket follows the spec pull request)

> **Status:** Approved (28 Sep 2026). Unit 1 (trackers criteria 14–15) and unit 2 (the workflow, the callers and `init`) built 28 Sep 2026; unit 3 (docs, criterion 10) not yet. **The change to criterion 2 and the data schema (the key from the branch name) approved 28 Sep 2026:** the MEAL-4 run showed that the branch is named after the run id in lowercase.

## OVERVIEW
A reusable GitHub Actions workflow, `board-sync.yml`, that keeps a ticket's state in step with
its spec pull request. A check on the spec pull request fails while the ticket needs input, so
the repo can block the merge. When the spec pull request is merged, the ticket moves to
Planning. A repo uses it through a short caller workflow (see [`adoption.md`](adoption.md)).

## WHY / INTENT
The board should show where the work really is, without a person moving tickets by hand. A
spec that still needs input is not ready to merge: the ticket-to-spec workflow already makes
its pull request a draft, but anyone can mark a draft ready and merge it. A check that reads
the ticket closes that gap, and branch protection lets the repo make the check required. The
merge itself is the fact the board follows, so board sync moves the ticket on every merge and
leaves the enforcement to the check.

This is the first step of board sync. Moves for feature pull requests (Building, Code review,
Done) and for a spec pull request closed without merging are decided later.

## INPUTS / OUTPUTS
- Inputs (`workflow_call`): `tracker` (`jira` | `github`), `seula-ref` (default `main`). Secrets
  for Jira: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`. The GitHub tracker uses the
  caller's `GITHUB_TOKEN`. The trigger is the caller's `pull_request` event.
- Outputs: a check result on the spec pull request; a state change on the ticket after a merge;
  a line in the job summary for each.

## DATA SCHEMA
- Config: `tracker.states.planning` (optional, no default; see [`trackers.md`](trackers.md),
  criterion 15).
- The spec pull request is recognized by its head branch: `seula/` and the run id in lowercase,
  for example `seula/meal-4` (Jira `MEAL-4`) or `seula/gh-42` (GitHub issue 42). A branch from
  an older seula adds the spec name: `seula/meal-3-copy-ingredients-to-clipboard` (see
  [`ticket-to-spec-workflow.md`](ticket-to-spec-workflow.md), criterion 16).

## ACCEPTANCE CRITERIA
1. `board-sync.yml` runs on `workflow_call` with the inputs and secrets above. It has two jobs:
   "ticket state" and "move on merge". Each job does nothing when the pull request's head
   branch doesn't start with `seula/`, or when the pull request comes from a fork, so GitHub
   shows it as skipped.
2. The job takes the ticket key from the start of the head branch name after `seula/`. The run
   id ends at the end of the name, or at the first `-` after its number. Jira: the key is the
   run id in upper case (`meal-3-copy-ingredients` gives `MEAL-3`). GitHub: the key is the
   number after `gh-` (`gh-42` gives `42`). The branch name reaches the job's scripts only
   through an environment variable, never inside a `run:` script. A name that gives no key
   matching the tracker's key pattern fails the job with exit 64, and seula calls no tracker
   API.
3. "ticket state" runs when a pull request is opened, reopened, marked ready for review, or
   gets a new commit. It reads the ticket's state with `seula tracker state` (see
   [`trackers.md`](trackers.md), criterion 14).
4. "ticket state" fails when the ticket is in the `needsInput` state. Its message names the
   ticket key and the state, and says: answer the questions on the ticket first. In every other
   state it passes.
5. "move on merge" runs when a pull request is closed and merged. It moves the ticket to the
   `planning` state with `seula tracker move`, whatever state the ticket is in.
6. When `tracker.states.planning` is not set, "move on merge" moves nothing and passes, and the
   job summary says the setting is not set.
7. Both jobs read `seula.config.json` from the pull request's base branch, never from the pull
   request itself, so a pull request can't change the state names it is checked against.
8. Each job gets only the tracker credentials: for Jira the three Jira secrets, for GitHub the
   caller's `GITHUB_TOKEN`. No job gets `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY` or
   `SEULA_GH_TOKEN`.
9. A failed tracker API call fails the job with seula's exit code and message (70, or 77 for a
   refused credential; see [`trackers.md`](trackers.md), criterion 9).
10. `docs/setup-jira.md` and `docs/setup-github-issues.md` say how to turn on the move to
    Planning (`tracker.states.planning`), and how to make "ticket state" a required check with
    branch protection, so a spec that needs input can't be merged.

## OUT OF SCOPE
- Moves for feature pull requests (Building, Code review, Done), and for a spec pull request
  that is closed without merging. They are decided later.
- Re-running the check when a person moves the ticket by hand in the tracker (see edge cases).
- Turning on branch protection. It is the repo's setting; the setup guides say how.
- Commenting on the ticket. Board sync reports in the Actions run and the job summary only.
- Stopping a person who can edit the caller workflow in a pull request from changing the check.
  Branch protection and code review cover that.

## EDGE CASES
- A person moves the ticket by hand, for example from Needs input to Spec review: the check keeps
  its old result until the next event. Re-run "ticket state" from the pull request page.
- The pull request is merged while "ticket state" is red, because the repo hasn't made it
  required: "move on merge" still moves the ticket to Planning (criterion 5).
- A draft pull request whose ticket needs input: the check fails, as for any other pull request.
- The tracker has no transition to the Planning status from the ticket's state: `move` exits
  70 and names the status ([`trackers.md`](trackers.md), edge cases); the job fails.
- A pull request from another branch, for example a feature pull request: both jobs are skipped,
  and a required "ticket state" check counts as passed.
- A pull request on a branch from an older seula, such as
  `seula/meal-3-copy-ingredients-to-clipboard`: the key is `MEAL-3`, and both jobs work as for
  a new branch (criterion 2).
- A `seula/` branch that seula didn't make, such as `seula/notes` or `seula/meal-4x`: it gives
  no key, so "ticket state" fails with exit 64 and "move on merge" moves nothing.
- A pull request from a fork, even one whose branch starts with `seula/`: GitHub gives it no
  secrets, and seula never opens one, so both jobs are skipped (criterion 1).

## PLAN
Built in three units, each with tests first, one commit and one pull request:
1. `seula tracker state` and the `planning` state ([`trackers.md`](trackers.md), criteria 1, 6,
   14 and 15).
2. `board-sync.yml`, the caller templates for both trackers, and `init` writing the caller
   (criteria 1–9; [`adoption.md`](adoption.md), criterion 13).
3. Docs: both setup guides (criterion 10), and troubleshooting entries for the new workflow's
   steps ([`adoption.md`](adoption.md), criterion 12).

Then, in mealPlanner, in the pin-bump pull request after the demo: the caller workflow, and
`"planning": "Planning"` in its config. Janne turns on branch protection.
