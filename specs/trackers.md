# FEATURE: Issue tracker adapters (Jira, GitHub Issues)

> **Status:** Approved (26 Sep 2026)

## OVERVIEW
seula reads tickets from, and reports back to, an issue tracker through a small adapter. Two
adapters ship with seula: Jira Cloud and GitHub Issues. A repo picks one in
`seula.config.json`. Everything else in seula stays the same whichever tracker a repo uses.

## WHY / INTENT
seula must work in any repo, and teams use different trackers. GitHub Issues lets anyone adopt
seula with nothing but a GitHub repo; Jira covers enterprise teams, where the tracker is where
people already read and write context. Keeping the tracker behind one interface means adding
another tracker later touches one file.

## INPUTS / OUTPUTS
- Inputs: the trigger event file (`$GITHUB_EVENT_PATH` in GitHub Actions); tracker credentials
  from environment variables; `tracker` settings in `seula.config.json`.
- Outputs: a ticket file for the gates and the agent; comments on the ticket; the ticket's
  workflow state changed.

## DATA SCHEMA
- Config: `tracker.type` (`jira` | `github`); `tracker.states.needsInput` and
  `tracker.states.specReview` (Jira status names, or GitHub label names).
- Ticket: `key`, `runId`, `title`, `body`, `url`.

## ACCEPTANCE CRITERIA
1. Each adapter provides three operations: read a ticket from the trigger event, add a comment
   to a ticket, and set a ticket's state to `needsInput` or `specReview`.
2. `seula tracker ticket --event <file> --out <file>` writes the ticket file (title, source URL,
   body) and prints a JSON line with `key` and `runId`. It exits 64 when the event holds no
   ticket, or when the key doesn't match the adapter's key pattern.
3. The Jira adapter reads a `repository_dispatch` event whose `client_payload` holds `key`,
   `summary`, `description` and `url`. Its key pattern is `^[A-Z][A-Z0-9]+-[0-9]+$`, and the run
   id is the key.
4. The GitHub adapter reads an `issues` event. The key is the issue number, and the run id is
   `GH-<number>`.
5. `seula tracker comment --key <key> --text-file <file>` adds the file's text as a comment.
   The Jira adapter uses the Jira Cloud REST API; the GitHub adapter uses the GitHub REST API
   for the current repository.
6. `seula tracker move --key <key> --state <needsInput|specReview>` sets the state. Jira: it
   applies the transition whose target status name matches the configured name, ignoring case.
   GitHub: it removes the other configured state labels and the trigger label, then adds the
   configured label.
7. Default states: Jira `Needs input` and `Spec review`; GitHub labels `seula:needs-input` and
   `seula:spec-review`, with trigger label `seula:ready-for-spec`.
8. Credentials come only from environment variables: Jira `JIRA_BASE_URL`, `JIRA_EMAIL`,
   `JIRA_API_TOKEN`; GitHub `GITHUB_TOKEN` and `GITHUB_REPOSITORY`. A `JIRA_BASE_URL` that
   doesn't start with `https://` is rejected.
9. A failed tracker API call exits 70 with the HTTP status and the tracker's message.

## OUT OF SCOPE
- Other trackers (Linear, GitLab, Azure Boards); they can be added behind the same interface.
- Reading ticket comments or history.
- Two-way sync between trackers.

## EDGE CASES
- Jira has no transition to the target status from the ticket's current status: `move` exits
  70 and names the target status.
- A GitHub label that doesn't exist yet: `move` creates it.
- An empty ticket description: the ticket file still has the title, and G0 decides whether it
  is enough.

## PLAN
1. `src/trackers/types.ts` (the interface), `jira.ts`, `github.ts`; `fetch`-based, no
   dependencies.
2. `tracker` section in `config.ts`; `seula tracker ticket|comment|move` in the CLI.
3. Tests with a fake `fetch` and recorded event files for both trackers.
