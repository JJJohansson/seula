# FEATURE: Adopting seula in a repo (`seula init`)

> **Status:** Approved (26 Sep 2026). Credential errors: criteria 11–12 approved and built 27 Sep 2026. **Board sync: the changes to the outputs and to criterion 12, and criterion 13, approved 28 Sep 2026, not built** (see [`board-sync.md`](board-sync.md)).

## OVERVIEW
`npx github:JJJohansson/seula init` sets seula up in any repo: a config file, three short
caller workflows that use seula's reusable workflows, and a spec template when the repo has
none. It never overwrites the repo's own files.

## WHY / INTENT
seula is an independent toolkit that a team takes into use when it needs it. Adoption must be
one command and a few secrets, and must leave the repo in charge: the caller workflows are
small enough to read in a minute, and updates come from seula by changing a pinned `ref`. The
repo decides which of its secrets seula gets.

## INPUTS / OUTPUTS
- Inputs: `--tracker <jira|github>` (required), `--spec-dir <dir>`, `--design-first`,
  `--seula-ref <ref>`, `--force`.
- Outputs: `seula.config.json`; `.github/workflows/seula-ticket-to-spec.yml`;
  `.github/workflows/seula-spec-check.yml`; `.github/workflows/seula-board-sync.yml`;
  `.seula/spec-template.md` when needed; a list of next steps.

## ACCEPTANCE CRITERIA
1. `seula init --tracker <jira|github>` writes `seula.config.json` with the tracker type, the
   spec directory, and the default states for that tracker.
2. Without `--spec-dir`, the spec directory is `specs/` if it exists, else `docs/specs/` if it
   exists, else `specs/`.
3. It writes `.github/workflows/seula-ticket-to-spec.yml`: a caller workflow of at most 30
   lines that triggers on the tracker's event (Jira: `repository_dispatch` of type
   `seula-ticket`; GitHub: `issues` labeled `seula:ready-for-spec`) and calls seula's
   `ticket-to-spec.yml` at the `--seula-ref` (default: the seula version running `init`). The
   caller passes only the secrets that seula's workflow uses for that tracker, each by name, and
   never `secrets: inherit`. GitHub: `ANTHROPIC_API_KEY`, `SEULA_GH_TOKEN`, `TYPESAFE_API_KEY`.
   Jira: the same three plus `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`. seula's
   `ANTHROPIC_API_KEY` comes from a repository secret named `SEULA_ANTHROPIC_API_KEY`, and its
   `TYPESAFE_API_KEY` from `SEULA_TYPESAFE_API_KEY`, so seula never spends a key that the repo
   keeps for its own app.
4. It writes `.github/workflows/seula-spec-check.yml`, which calls seula's `spec-check.yml` on
   pull requests that change files in the spec directory.
5. When the repo has no `SPEC_DRIVEN_DEVELOPMENT.md` and no `.seula/spec-template.md`, it writes
   `.seula/spec-template.md` from seula's template and sets `template` in the config to it.
6. It never overwrites an existing file unless `--force` is given. It lists each file as
   written or skipped, and exits 0.
7. `--design-first` sets `design.required` to `true` in the config (see
   [`g0-ticket-gate.md`](g0-ticket-gate.md)).
8. Running `init` a second time with the same options writes nothing new and reports every file
   as skipped.
9. At the end, it prints the repository secrets to add, by the names the caller reads
   (`SEULA_ANTHROPIC_API_KEY`, `SEULA_GH_TOKEN`, optional `SEULA_TYPESAFE_API_KEY`, and for Jira
   `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`), and the link to the setup guide for the
   chosen tracker.
10. `init` makes no network calls and never writes secrets.
11. `docs/setup-jira.md` says that when moving a ticket to the trigger status starts no
    workflow run, the Jira automation's audit log shows why, for example GitHub refusing an
    expired dispatch token. seula can't report this, because no run starts.
12. `docs/troubleshooting.md` has one entry for each step of `ticket-to-spec.yml` and of
    `board-sync.yml`, under the step's name as Actions shows it. Each entry says what the step
    does, what its failure looks like in Actions and on the ticket, and what to check. The page
    also covers a move that starts no run (criterion 11) and Anthropic credit that has run out.
    A test fails when a step of either workflow has no entry.
13. It writes `.github/workflows/seula-board-sync.yml`: a caller workflow of at most 30 lines
    that triggers on `pull_request` events (opened, reopened, synchronize, ready_for_review and
    closed) and calls seula's `board-sync.yml` at the `--seula-ref` (see
    [`board-sync.md`](board-sync.md)). It passes only the tracker credentials, each by name:
    for Jira `JIRA_BASE_URL`, `JIRA_EMAIL` and `JIRA_API_TOKEN`; for GitHub none, and the
    workflow gets `issues: write` permission for its `GITHUB_TOKEN`.

## OUT OF SCOPE
- Creating GitHub secrets, Jira automation rules or GitHub labels (the setup guides cover them;
  the workflow creates missing labels).
- Installing the Claude Code plugin locally.
- Migrating an existing repo's specs to seula's format.
- Updating a caller workflow that an earlier `init` wrote (rerun with `--force`).

## EDGE CASES
- Not a git repo: `init` still writes the files, and warns that the workflows need GitHub.
- `seula.config.json` exists but has no `tracker`: skipped without `--force`; the output says
  which setting is missing.

## PLAN
1. `src/init.ts`: file plan (path, content, reason), write-if-absent, report.
2. Caller workflow templates for each tracker in `templates/`.
3. `docs/setup-jira.md` and `docs/setup-github-issues.md` (split from the current setup guide).
4. Tests in a temporary directory: fresh repo, repo with `docs/specs/`, second run, `--force`,
   `--design-first`.
