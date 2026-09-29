# Setting up seula with GitHub Issues

Adding the label **`seula:ready-for-spec`** to an issue starts seula's ticket-to-spec workflow:
it checks the issue (G0), lets Claude write the spec with G1 in its loop, opens a pull request,
and comments back on the issue. About 15 minutes.

## 1. Run `init`

From the repo's root. seula has no release yet, so pin a full commit SHA of seula with
`--seula-ref`:

```bash
git ls-remote https://github.com/JJJohansson/seula main    # the latest commit SHA
npx github:JJJohansson/seula init --tracker github --seula-ref <commit SHA>
```

Commit the files it writes (`seula.config.json`, `.github/workflows/seula-*.yml`, and
`.seula/spec-template.md` when the repo has no spec template) and merge them to the default
branch. Issue-triggered workflows only run from the default branch.

## 2. Token

Create a fine-grained personal access token (GitHub → Settings → Developer settings →
Fine-grained tokens) with access to **only this repo** and these permissions:

- **Contents:** Read and write (push the spec branch)
- **Pull requests:** Read and write (open the pull request)
- **Issues:** Read and write (read and post comments, set labels)

The workflow pushes and opens the pull request with this token, not the default
`GITHUB_TOKEN`, because pushes made with `GITHUB_TOKEN` don't start the repo's CI. Give it a
short expiry and revoke it when you stop using seula.

## 3. Secrets

In the repo: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Value |
|---|---|
| `SEULA_ANTHROPIC_API_KEY` | Anthropic API key for seula (platform.claude.com) |
| `SEULA_GH_TOKEN` | the token from step 2 |
| `SEULA_TYPESAFE_API_KEY` | Jev API key (optional: without it the Jev checks are skipped) |

The caller workflow gives seula only these secrets, each by name, and never your other
secrets. The two API keys have `SEULA_` names, so seula doesn't spend an `ANTHROPIC_API_KEY`
or `TYPESAFE_API_KEY` that your app already uses.

## 4. The trigger label

Create the label **`seula:ready-for-spec`** once (Issues → Labels → New label). seula creates
`seula:needs-input` and `seula:spec-review` itself the first time it needs them. Label names can
be changed in `seula.config.json` → `tracker`.

## 5. Test it

1. Open an issue with a clear goal, for example "Let users export their saved items as a CSV
   file, one row per item, with a header row."
2. Add the `seula:ready-for-spec` label.
3. Within a few minutes: a pull request on a `seula/gh-<number>` branch, a comment on the
   issue with its link, and the label `seula:spec-review`.
4. Open a second issue with only a title and add the label. G0 should send it back: a comment
   with questions and the label `seula:needs-input`.
5. Answer the questions in a comment on that issue, then add the label
   `seula:ready-for-spec` again. seula reads the comments too, so the answer counts.

## 6. Board sync (optional)

`init` also writes `.github/workflows/seula-board-sync.yml`. It keeps the issue in step with its
spec pull request. It needs no secret: the caller workflow grants `issues: write` to the
workflow's own `GITHUB_TOKEN`.

1. **Label the issue `seula:planning` when the spec is merged.** Add the label name to
   `seula.config.json`:

   ```json
   "tracker": { "type": "github", "states": { "needsInput": "seula:needs-input", "specReview": "seula:spec-review", "planning": "seula:planning" } }
   ```

   Without `tracker.states.planning`, a merge changes no label. seula creates the label the
   first time it needs it.
2. **Block merging a spec that needs input.** Each spec pull request gets the check
   `seula / ticket state`. It fails while the issue has the `seula:needs-input` label. To make
   it block the merge, go to the repository's **Settings → Rules → Rulesets** (or the older
   branch protection rules), target the default branch, turn on **Require status checks to
   pass**, and add `seula / ticket state`. GitHub lists the check only after it has run once, so
   open or update a spec pull request first. Pull requests from other branches skip the check,
   and a skipped check counts as passed.

A person who changes the labels by hand doesn't start the check again: re-run it from the pull
request page. See [troubleshooting](troubleshooting.md#board-sync-steps) for its steps.

## 7. The plan step

`init` also writes `.github/workflows/seula-spec-to-plan.yml`. When a spec pull request is
merged, the merge approves the spec, and seula:

1. marks the spec *Approved* in its status line;
2. lets Claude read the code and write the spec's `## PLAN` section: a task, a test and files
   for every acceptance criterion;
3. checks the plan with G2, and flags sign-in, stored data or personal data for the reviewer;
4. opens a plan pull request on a `seula-plan/` branch, and comments on the issue with its
   link. The issue's labels stay as they are; board sync adds `seula:planning`.

It needs no new secret: it uses the secrets from step 3. Each merged spec costs a second Claude
run, about as much as the spec run. To turn it off, delete
`.github/workflows/seula-spec-to-plan.yml`. See [troubleshooting](troubleshooting.md#plan-steps)
for its steps.

## Options

- **Design first:** `init --design-first` (or `"design": { "required": true }` in the config).
  Issues that change the UI must then link their design (a path under `docs/design/`, or a
  Figma link) before a spec is written.
- **Your spec-driven-development skill:** add `sdd-skill-repo: <owner>/<repo>` under `with:` in
  `.github/workflows/seula-ticket-to-spec.yml`, and the agent uses it. The agent doesn't load
  your repo's `.claude/` settings, hooks or skills, so this input is how it gets the skill.
- **Another model:** add `model: sonnet` under `with:`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Adding the label starts nothing | The caller workflow isn't on the default branch, or the label name differs from `triggerLabel` |
| A step fails, or the issue gets "seula failed to run" | See [troubleshooting](troubleshooting.md): one entry for each step, under its name in Actions. Remove the trigger label and add it again to start seula again |
| The comment or label step warns | The token lacks Issues: Read and write |
| The pull request has no CI checks | The branch was pushed with `GITHUB_TOKEN` instead of `SEULA_GH_TOKEN` |
