# FEATURE: Reusable ticket-to-spec and spec-check workflows

> **Status:** Approved (26 Sep 2026)

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
- Outputs: a branch `seula/<run id>-<spec name>` with the spec change, the ticket file and the
  run file; a pull request; a comment and a state change on the ticket.

## ACCEPTANCE CRITERIA
1. `ticket-to-spec.yml` runs on `workflow_call` with the inputs and secrets above, and checks
   out the calling repo and seula at `seula-ref`.
2. It reads the ticket with `seula tracker ticket` from the event file. An invalid ticket stops
   the run before any other step.
3. It runs G0 on the ticket file. When G0 returns back or unsure, it posts G0's asks and notes
   on the ticket, sets the ticket to `needsInput`, and writes no spec.
4. When G0 passes or is skipped, Claude writes or updates one spec in the repo's configured
   spec directory with the spec-writer prompt and the seula plugin, and runs G1 until G1 passes,
   is unsure, or reaches the loop limit.
5. The agent can edit only files in the spec directory and read only files in the working
   directory and its installed skills. It can't run git or fetch web pages. Its only shell
   command is seula's G1 gate, and its shell commands can't see the Anthropic key.
6. No ticket field appears in a `run:` script: ticket text reaches the gates and the agent only
   as a file. Each secret is given only to the steps that use it. No credential is stored on
   disk while the agent runs.
7. The workflow commits the spec, the ticket file and the run file to the branch, and opens a
   pull request (or updates the existing one) that links the ticket, lists every gate result and
   its feedback, and states which checks ran.
8. The pull request opens ready for review only when the run file's last G1 result is pass, or
   skipped because no Jev key is configured, whatever the agent reports; otherwise it opens as
   a draft.
9. After the pull request opens, the workflow posts its link on the ticket and sets the ticket
   to `specReview` when ready, or to `needsInput` with the agent's open questions when not.
10. The workflow never sets a spec to a buildable status; a new spec gets the first
    non-buildable status in the config (`Idea` by default).
11. The Claude cost of the run is added to the run file.
12. `spec-check.yml` runs on `workflow_call`, finds the spec files that the pull request adds
    or changes, and runs `seula check-spec` on them, skipping the config's `ignore` list. The
    check fails when a spec has a format error.
13. Before it commits or posts anything, the workflow checks the files and the agent's output
    for the value of each secret it holds, and stops the run when it finds one.
14. The agent's permissions, hooks and tools come only from the workflow. The adopting repo's
    Claude Code configuration (`.claude/settings.json`, `.claude/settings.local.json`,
    `.mcp.json`, its project skills and subagents) does not change them, and none of its hooks
    run.

## OUT OF SCOPE
- Building the feature from an approved spec.
- Merging anything automatically.
- Gates G2 to G5.

## EDGE CASES
- The same ticket triggers again after `needsInput`: the branch is regenerated and the
  existing pull request's description is updated.
- The agent returns no valid spec path: no pull request; the ticket gets a comment; the run
  fails visibly.
- No `TYPESAFE_API_KEY`: Jev checks are recorded as skipped; the format checks still run.
- A tracker call fails after the pull request opened: the run logs a warning and keeps the
  pull request.

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
6. Criterion 14 (added 26 Sep 2026): the agent runs with `--setting-sources user`. Under `-p`,
   Claude Code ignores a project's allow rules, but it still runs the project's hooks, applies
   its `env` block, connects its `.mcp.json` servers, and honors a project skill's
   `allowed-tools`. Leaving out the project and local sources stops all of these. The agent
   still gets the seula plugin (`--plugin-dir`) and the skills installed in
   `~/.claude/skills`. It doesn't get the repo's `CLAUDE.md` automatically (the prompt tells it
   to read that file), `.claude/rules`, or the repo's own `.claude/skills`; a repo gives the
   agent its spec-driven-development skill with the `sdd-skill-repo` input.
   `test/workflows.test.ts` checks the flag.
