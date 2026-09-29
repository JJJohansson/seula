# Setting up seula with Jira

Moving a Jira ticket to **Ready for spec** makes Jira send a `repository_dispatch` event to the
repo. seula's ticket-to-spec workflow then checks the ticket (G0), lets Claude write the spec
with G1 in its loop, opens a pull request, and comments back on the ticket. About 30 minutes. You
need admin rights on the Jira project and the GitHub repo.

## 1. Run `init`

From the repo's root. seula has no release yet, so pin a full commit SHA of seula with
`--seula-ref`:

```bash
git ls-remote https://github.com/JJJohansson/seula main    # the latest commit SHA
npx github:JJJohansson/seula init --tracker jira --seula-ref <commit SHA>
```

Commit the files it writes and merge them to the default branch: `repository_dispatch` only
starts workflows that are on the default branch.

## 2. Jira project and statuses

Use a project (the free Jira Cloud plan is enough) whose workflow has these statuses:

**Ready for spec → Needs input → Spec review → Planning → Code review → Done**

For a first setup, allow transitions from any status to any status. seula moves tickets by the
**status name**; if yours differ, set them in `seula.config.json` → `tracker.states`. Planning
is where [board sync](#7-board-sync-optional) moves a ticket when its spec pull request is
merged.

## 3. Tokens

| Token | Where to create it | Permissions | Used by |
|---|---|---|---|
| Jira dispatch token | GitHub → Settings → Developer settings → Fine-grained tokens | Only this repo; **Contents: Read and write** (needed for `repository_dispatch`) | The Jira automation rule |
| seula bot token | Same place | Only this repo; **Contents: Read and write**, **Pull requests: Read and write** | The workflow, to push the branch and open the pull request. Pushes made with the default `GITHUB_TOKEN` don't start CI. |
| Jira API token | id.atlassian.com → Security → API tokens | Your Jira user's rights | The workflow, to read comments on tickets, comment on them and move them |

Give the GitHub tokens a short expiry and revoke them when you stop using seula. The dispatch
token can write to the repo, so keep it only in the Jira rule.

## 4. Secrets

In the repo: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Value |
|---|---|
| `SEULA_ANTHROPIC_API_KEY` | Anthropic API key for seula (platform.claude.com) |
| `SEULA_GH_TOKEN` | the seula bot token |
| `SEULA_TYPESAFE_API_KEY` | Jev API key (optional: without it the Jev checks are skipped) |
| `JIRA_BASE_URL` | `https://<your-site>.atlassian.net` |
| `JIRA_EMAIL` | the email of the Atlassian account that owns the Jira API token |
| `JIRA_API_TOKEN` | the Jira API token |

The caller workflow gives seula only these secrets, each by name, and never your other
secrets. The two API keys have `SEULA_` names, so seula doesn't spend an `ANTHROPIC_API_KEY`
or `TYPESAFE_API_KEY` that your app already uses.

## 5. Jira automation rule

**Project settings → Automation → Create rule**

1. **Trigger:** *Work item transitioned*, to status **Ready for spec**.
2. **Action:** *Send web request*
   - **URL:** `https://api.github.com/repos/<owner>/<repo>/dispatches`
   - **HTTP method:** POST
   - **Headers** (mark the Authorization header as hidden):
     - `Authorization`: `Bearer <Jira dispatch token>`
     - `Accept`: `application/vnd.github+json`
     - `X-GitHub-Api-Version`: `2022-11-28`
   - **Web request body:** *Custom data*:

```json
{
  "event_type": "seula-ticket",
  "client_payload": {
    "key": "{{issue.key}}",
    "summary": "{{issue.summary.jsonEncode}}",
    "description": "{{issue.description.jsonEncode}}",
    "url": "{{issue.url}}"
  }
}
```

3. Name the rule (for example "seula: ticket to spec") and turn it on.

GitHub answers a correct request with **204 No Content**; the rule's audit log shows it.

## 6. Test it

1. Create a ticket with a clear goal, then move it to **Ready for spec**.
2. Within a few minutes: a pull request on a `seula/<key>` branch (the key in lowercase), a
   comment on the ticket with its link, and the ticket in **Spec review**.
3. Create a second ticket with only a title and move it to **Ready for spec**. G0 should send it
   back: a comment with questions, and the ticket in **Needs input**.
4. Answer the questions in a comment on that ticket, then move it to **Ready for spec** again.
   seula reads the comments too, so the answer counts. The earlier comments stay on the ticket.

## 7. Board sync (optional)

`init` also writes `.github/workflows/seula-board-sync.yml`. It keeps the ticket in step with
its spec pull request, with the Jira secrets from step 4 and no others.

1. **Move the ticket to Planning when the spec is merged.** Add the status name to
   `seula.config.json`:

   ```json
   "tracker": { "type": "jira", "states": { "needsInput": "Needs input", "specReview": "Spec review", "planning": "Planning" } }
   ```

   Without `tracker.states.planning`, a merge moves nothing.
2. **Block merging a spec that needs input.** Each spec pull request gets the check
   `seula / ticket state`. It fails while the ticket is in **Needs input**. To make it block the
   merge, go to the repository's **Settings → Rules → Rulesets** (or the older branch protection
   rules), target the default branch, turn on **Require status checks to pass**, and add
   `seula / ticket state`. GitHub lists the check only after it has run once, so open or update
   a spec pull request first. Pull requests from other branches skip the check, and a skipped
   check counts as passed.

A person who moves the ticket by hand doesn't start the check again: re-run it from the pull
request page. See [troubleshooting](troubleshooting.md#board-sync-steps) for its steps.

## 8. The plan step

`init` also writes `.github/workflows/seula-spec-to-plan.yml`. When a spec pull request is
merged, the merge approves the spec, and seula:

1. marks the spec *Approved* in its status line;
2. lets Claude read the code and write the spec's `## PLAN` section: a task, a test and files
   for every acceptance criterion;
3. checks the plan with G2, and flags sign-in, stored data or personal data for the reviewer;
4. opens a plan pull request on a `seula-plan/` branch, and comments on the ticket with its
   link. The ticket stays where it is; board sync moves it to Planning.

It needs no new secret: it uses the secrets from step 4. Each merged spec costs a second Claude
run, about as much as the spec run. To turn it off, delete
`.github/workflows/seula-spec-to-plan.yml`. See [troubleshooting](troubleshooting.md#plan-steps)
for its steps.

## Options

- **Design first:** `init --design-first` (or `"design": { "required": true }` in the config).
  Tickets that change the UI must then link their design before a spec is written.
- **Your spec-driven-development skill:** add `sdd-skill-repo: <owner>/<repo>` under `with:` in
  `.github/workflows/seula-ticket-to-spec.yml`. The agent doesn't load your repo's `.claude/`
  settings, hooks or skills, so this input is how it gets the skill.
- **Another model:** add `model: sonnet` under `with:`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Moving a ticket starts no run | Open the rule's audit log. 401: GitHub refused the dispatch token (wrong or expired). 404: a wrong repository, or a token without access to it or without Contents write. seula can't report this, because no run starts |
| 204, but no workflow run | The caller workflow isn't on the default branch, or `event_type` isn't `seula-ticket` |
| A step fails, or the ticket gets "seula failed to run" | See [troubleshooting](troubleshooting.md): one entry for each step, under its name in Actions. A technical failure leaves the ticket in **Ready for spec**; move it out and back to start seula again |
| A comment appears, but the ticket doesn't move | No transition to that status from the current one, or the status names differ (`tracker.states`) |
| The pull request has no CI checks | The branch was pushed with `GITHUB_TOKEN` instead of `SEULA_GH_TOKEN` |
