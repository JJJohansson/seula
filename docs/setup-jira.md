# Setting up seula with Jira

Moving a Jira ticket to **Ready for spec** makes Jira send a `repository_dispatch` event to the
repo. seula's ticket-to-spec workflow then checks the ticket (G0), lets Claude write the spec
with G1 in its loop, opens a pull request, and comments back on the ticket. About 30 minutes. You
need admin rights on the Jira project and the GitHub repo.

## 1. Run `init`

From the repo's root:

```bash
npx github:JJJohansson/seula init --tracker jira
```

Commit the files it writes and merge them to the default branch: `repository_dispatch` only
starts workflows that are on the default branch.

## 2. Jira project and statuses

Use a project (the free Jira Cloud plan is enough) whose workflow has these statuses:

**Ready for spec → Needs input → Spec review → Approved → Code review → Done**

For a first setup, allow transitions from any status to any status. seula moves tickets by the
**status name**; if yours differ, set them in `seula.config.json` → `tracker.states`.

## 3. Tokens

| Token | Where to create it | Permissions | Used by |
|---|---|---|---|
| Jira dispatch token | GitHub → Settings → Developer settings → Fine-grained tokens | Only this repo; **Contents: Read and write** (needed for `repository_dispatch`) | The Jira automation rule |
| seula bot token | Same place | Only this repo; **Contents: Read and write**, **Pull requests: Read and write** | The workflow, to push the branch and open the pull request. Pushes made with the default `GITHUB_TOKEN` don't start CI. |
| Jira API token | id.atlassian.com → Security → API tokens | Your Jira user's rights | The workflow, to comment on and move tickets |

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
2. Within a few minutes: a pull request on a `seula/<key>-…` branch, a comment on the ticket with
   its link, and the ticket in **Spec review**.
3. Create a second ticket with only a title and move it to **Ready for spec**. G0 should send it
   back: a comment with questions, and the ticket in **Needs input**.

## Options

- **Design first:** `init --design-first` (or `"design": { "required": true }` in the config).
  Tickets that change the UI must then link their design before a spec is written.
- **Your spec-driven-development skill:** add `sdd-skill-repo: <owner>/<repo>` under `with:` in
  `.github/workflows/seula-ticket-to-spec.yml`.
- **Another model:** add `model: sonnet` under `with:`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| The rule's audit log shows 401 or 404 | The dispatch token is wrong, expired, lacks Contents write, or has no access to the repo |
| 204, but no workflow run | The caller workflow isn't on the default branch, or `event_type` isn't `seula-ticket` |
| "Check out the repo" fails | `SEULA_GH_TOKEN` is missing or expired |
| "Check out seula" fails | The seula repo isn't reachable: make it public, or allow access to it in its Actions settings |
| "Write the spec" fails to authenticate | `SEULA_ANTHROPIC_API_KEY` is missing or wrong (seula doesn't read a secret named `ANTHROPIC_API_KEY`) |
| A comment appears, but the ticket doesn't move | No transition to that status from the current one, or the status names differ (`tracker.states`) |
| The pull request has no CI checks | The branch was pushed with `GITHUB_TOKEN` instead of `SEULA_GH_TOKEN` |
