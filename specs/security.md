# FEATURE: Security bar (supply chain, secrets, threat model)

> **Status:** Approved (2026-09-26). Criteria 1 and 2 are met; the rest are built after 2026-09-28. The open questions are still open.

## OVERVIEW
The security rules that apply to all of seula: its CLI, its reusable workflows and its own
repo. Other specs add rules for one part (the agent's permissions are in
[`ticket-to-spec-workflow.md`](ticket-to-spec-workflow.md), criteria 5, 6, 13 and 14); this
spec holds the rules that no single feature owns, and the threat model. It follows the supply
chain and secrets rules that adopting repos already hold themselves to, so seula doesn't lower
their bar.

## WHY / INTENT
Repos that adopt seula run its workflows with their own secrets: an Anthropic key, a GitHub
token that can push, Jira credentials. A weakness in seula, in one of its dependencies or in a
tool it installs becomes a weakness in every repo that uses it. seula checks other people's
work with gates, so its own supply chain must be checked by gates too.

## INPUTS / OUTPUTS
- Inputs: seula's workflows, its lockfile, its source, and each push and pull request.
- Outputs: CI checks that fail on a finding, Dependabot pull requests, and the threat model
  below.

## ACCEPTANCE CRITERIA
1. Every Action in seula's workflows is pinned to a full commit SHA, with its version in a
   comment.
2. Every tool that a workflow installs at run time is pinned to an exact version. Claude Code
   is installed as `@anthropic-ai/claude-code@<version>`, at a version that supports every
   permission setting the ticket-to-spec workflow uses. A container image is pinned by version
   and digest.
3. CI installs seula's dependencies from the lockfile (`npm ci`).
4. Dependabot opens update pull requests for npm and GitHub Actions every week, and waits 7
   days before it proposes a newly published version.
5. CI fails when `npm audit` reports a high or critical vulnerability in any dependency,
   development dependencies included, because `npx github:…` installs them to build seula.
6. CI scans the commits of every push and pull request for secrets with gitleaks, and fails on
   a finding.
7. Semgrep OSS runs the `p/default` rules on every pull request, on every push to `main` and
   once a week, and fails on a finding. Each inline suppression has a comment that gives the
   reason.
8. seula never prints the value of a credential: not in its output, its error messages, its
   run files, or the text that it posts on a pull request or a ticket.
9. The CLI connects only to the Jev endpoint in the config and to the tracker named by its
   environment (`JIRA_BASE_URL`, or `GITHUB_API_URL`, default `https://api.github.com`).
   `init`, `check-spec`, `status`, `config` and `prompt` make no network calls.
10. When the repo is public, GitHub secret scanning and push protection are on.
11. The THREAT MODEL below names each asset, each threat and the criteria that defend against
    it, and each accepted risk. `docs/quality-gates.md` links to it from its security notes.

## THREAT MODEL

**Assets:** the secrets that an adopting repo passes to seula's workflow (an Anthropic key, a
GitHub token that can push branches and open pull requests, Jira credentials, a Jev key); the
adopting repo's specs; the trust that a spec pull request was checked by the gates.

| Threat | Defended by |
|---|---|
| A ticket contains instructions aimed at the agent (prompt injection) | Ticket text reaches the agent only as a file; narrow agent permissions; no credential on disk or in its shell; a secret in its output stops the run ([`ticket-to-spec-workflow.md`](ticket-to-spec-workflow.md) criteria 5, 6, 13, 14) |
| The agent's own report claims a result the gates didn't give | The workflow reads the run file, not the agent's report (ticket-to-spec criterion 8) |
| A compromised or broken Action, npm package or tool | Criteria 1–5, 7 |
| A secret committed to seula's repo | Criteria 6, 10 |
| seula leaks a secret it handles | Criterion 8; GitHub log masking |
| A change on seula's `main` reaches adopters unreviewed | Adopters pin a release (see OPEN QUESTIONS) and pass secrets by name, never `secrets: inherit` |
| seula sends data somewhere unexpected | Criterion 9 |

**Accepted risks:**
- The secret check (ticket-to-spec criterion 13) finds only exact values. An agent that
  encodes a secret (for example in base64) before it writes it is not caught; the narrow
  permissions are the defense against that.
- The Jev check for text aimed at the agent is a classifier, not a security boundary.
- The optional `sdd-skill-repo` is cloned at its latest commit. The adopting repo chooses and
  trusts that repo.
- Claude Code has no Dependabot updates when it is installed with `npm install -g`. A person
  bumps its pinned version.

## OUT OF SCOPE
- Application security (sessions, CORS, headers and so on): seula has no server.
- Signed releases, build provenance and an SBOM.
- Security rules for the repos that adopt seula. Each repo owns its own.

## EDGE CASES
- An advisory has no fixed version yet: a person records it here as an accepted risk, with a
  date to check again, before CI may pass with it.
- Dependabot proposes a new Claude Code version: it can't, because of the global install. The
  pinned version is bumped by hand after a check that the permission settings still work.
- A Semgrep rule gives a false positive: an inline `nosemgrep` comment with the reason.
- gitleaks finds a secret in old history: the secret is revoked first, then removed or
  allowlisted with a reason.

## OPEN QUESTIONS
1. **How `init` pins adopters.** Today `init` writes the release tag (`@v0.1.0`). A tag can be
   moved; a commit SHA can't. `init` makes no network calls ([`adoption.md`](adoption.md)
   criterion 10), so it can't look the SHA up. Options: write the SHA into the package when a
   release is made, or keep the tag and tell adopters to pin the SHA themselves (as mealPlanner
   does). This belongs to `adoption.md`.
2. **Branch protection on `main`.** Require a pull request and passing checks before a merge
   to `main`? It stops direct pushes, including the agent's.

## PLAN
1. `.github/dependabot.yml` (criterion 4).
2. In `ci.yml`: `npm ci`; a `security` job with `npm audit --audit-level=high` and gitleaks
   (criteria 3, 5, 6).
3. `.github/workflows/sast.yml` with a version- and digest-pinned Semgrep image (criterion 7).
4. Pin Claude Code in `ticket-to-spec.yml`, and add a test to `test/workflows.test.ts`
   (criterion 2).
5. Tests for criteria 8 and 9: tracker and Jev errors don't contain credentials; the offline
   commands make no network calls.
6. Person: turn on secret scanning and push protection when the repo goes public
   (criterion 10).
7. Update `docs/quality-gates.md` security notes to link to this spec (criterion 11).

---
Do not begin implementation until the acceptance criteria are confirmed.
