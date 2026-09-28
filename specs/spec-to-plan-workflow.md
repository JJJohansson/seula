# FEATURE: Reusable spec-to-plan workflow

> **Status:** Idea. Drafted 28 Sep 2026 with Janne, not approved.

## OVERVIEW
A reusable GitHub Actions workflow, `spec-to-plan.yml`. When a spec pull request is merged,
Claude writes an implementation plan into the spec's `## PLAN` section, with G2 in its loop.
The workflow then checks the plan with G2 and Jev, marks the spec *Approved*, and opens a plan
pull request for a person to review. It writes no code. A repo uses it through a short caller
workflow (see [`adoption.md`](adoption.md)).

## WHY / INTENT
Merging a spec pull request is the person's approval of the spec. The next step is a plan:
which tasks, which tests and which files. It is the same shape as ticket-to-spec: an agent
writes a document, a gate checks it, and a person approves it. Planning before code catches a
missed criterion or a risky change while it is still cheap to fix. Approving the plan and
building stay with a person for now.

## INPUTS / OUTPUTS
- Inputs (`workflow_call`): `tracker` (`jira` | `github`), `seula-ref` (default `main`), `model`
  (default `opus`), `base-branch` (default `main`). Secrets: `ANTHROPIC_API_KEY`,
  `SEULA_GH_TOKEN`, optional `TYPESAFE_API_KEY`, and for Jira `JIRA_BASE_URL`, `JIRA_EMAIL`,
  `JIRA_API_TOKEN`. The trigger is the caller's `pull_request` event when a pull request is
  closed.
- Outputs: a branch `seula-plan/<run id in lowercase>` with the spec (its status and its plan)
  and the run file; a plan pull request; a comment on the ticket.

## DATA SCHEMA
- The plan format and G2: [`g2-plan-gate.md`](g2-plan-gate.md).
- The spec pull request and its ticket key: the head branch, as in
  [`board-sync.md`](board-sync.md) criterion 2.

## ACCEPTANCE CRITERIA
1. `spec-to-plan.yml` runs on `workflow_call` with the inputs and secrets above. Its job runs
   only when the pull request was merged, its head branch starts with `seula/`, and it does not
   come from a fork. Otherwise GitHub shows the job as skipped.
2. It checks out the repo at `base-branch` after the merge, and seula at `seula-ref`. It takes
   the ticket key from the head branch name with `--branch` ([`trackers.md`](trackers.md)
   criterion 16).
3. The spec is the one file in the spec directory that the merged pull request added or
   changed. When there is none, or more than one, the run stops with a technical failure and
   opens no pull request.
4. The workflow sets the spec's status line to `Approved`, with the date and the number of the
   merged pull request. When `Approved` is not one of the config's statuses, the run stops with
   a technical failure. The agent never changes the status line.
5. Claude writes the plan into the spec's `## PLAN` section with the planner prompt
   (`prompts/planner.md`) and the seula plugin. It runs `seula gate g2` with `--approved` (the
   spec as merged) until G2 passes, is unsure, or reaches the loop limit.
6. The agent can read the whole working directory and its installed skills, and can edit only
   the spec file. Its only shell command is seula's G2 gate. Otherwise it has the same limits as
   the spec writer: no git, no web pages, no Anthropic key in its shell commands, and no GitHub,
   Jira or Jev key ([`ticket-to-spec-workflow.md`](ticket-to-spec-workflow.md) criteria 5–6
   and 14).
7. After the agent, the workflow runs G2 with the Jev key and `--approved` on the spec.
8. The workflow checks the agent's output and the spec for secrets before it commits, as
   ticket-to-spec does (criterion 13 there).
9. The workflow commits the spec and the run file to `seula-plan/<run id in lowercase>` and
   opens a pull request into `base-branch`, or updates the ticket's open plan pull request. The
   pull request links the ticket and the merged spec pull request, and lists every G2 result
   and its feedback.
10. The plan pull request is ready for review only when the agent has no open questions and
    the last G2 result is pass, skipped because no Jev key is configured, or unsure. When G2 is
    unsure, the pull request lists the flags under "Needs your judgement". Otherwise it is a
    draft, and it lists G2's errors and the agent's questions.
11. The workflow comments on the ticket with the plan pull request's link, and with the flags
    or the questions when there are any. The comment starts with `seula · `
    ([`ticket-to-spec-workflow.md`](ticket-to-spec-workflow.md) criterion 19). The ticket's
    state doesn't change.
12. A technical failure is reported as in ticket-to-spec (criteria 17, 27 and 28 there): a
    comment that starts with "seula failed to run", the reason on the run and in the job
    summary, and a refused credential named by its secret names.
13. The Claude cost of the run is added to the run file with its breakdown, as in
    ticket-to-spec (criterion 11 there).
14. Merging a plan pull request starts no workflow of seula's: its branch doesn't start with
    `seula/`. The ticket-to-spec workflow never takes a `seula-plan/` branch as the ticket's
    spec branch.

## OUT OF SCOPE
- Writing code, and gates G3 to G5.
- Moving the ticket to Building when the plan pull request is merged. It is a later board sync
  step.
- Running the plan step again on demand, and a plan pull request that is closed without
  merging.
- Plans kept in a separate file.

## EDGE CASES
- The spec pull request is merged while its ticket needs input, because the repo doesn't require
  the "ticket state" check: merging is still the approval, and the plan step runs.
- The ticket already has an open plan pull request, because its spec was changed and merged
  again: the run updates that pull request (criterion 9).
- The merged pull request changed a spec that already has a `## PLAN`: the agent updates the
  plan, and G2 checks it the same way.
- A spec pull request on a branch from an older seula (`seula/meal-3-copy-…`): the key comes
  from the start of the name, as for board sync.

## PLAN
To be split into units after approval: the G2 gate, the planner prompt, the workflow, the
caller and `init` ([`adoption.md`](adoption.md)), then the docs.
