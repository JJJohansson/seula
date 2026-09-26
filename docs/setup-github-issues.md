# Setting up seula with GitHub Issues

Adding the label **`seula:ready-for-spec`** to an issue starts seula's ticket-to-spec workflow:
it checks the issue (G0), lets Claude write the spec with G1 in its loop, opens a pull request,
and comments back on the issue. About 15 minutes.

## 1. Run `init`

From the repo's root:

```bash
npx github:JJJohansson/seula init --tracker github
```

Commit the files it writes (`seula.config.json`, `.github/workflows/seula-*.yml`, and
`.seula/spec-template.md` when the repo has no spec template) and merge them to the default
branch. Issue-triggered workflows only run from the default branch.

## 2. Token

Create a fine-grained personal access token (GitHub → Settings → Developer settings →
Fine-grained tokens) with access to **only this repo** and these permissions:

- **Contents:** Read and write (push the spec branch)
- **Pull requests:** Read and write (open the pull request)
- **Issues:** Read and write (comment and set labels)

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

1. Open an issue with a clear goal, for example "Let users export this week's shopping list as a
   CSV file, one row per item, with a header row."
2. Add the `seula:ready-for-spec` label.
3. Within a few minutes: a pull request on a `seula/gh-<number>-…` branch, a comment on the
   issue with its link, and the label `seula:spec-review`.
4. Open a second issue with only a title and add the label. G0 should send it back: a comment
   with questions and the label `seula:needs-input`.

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
| "Check out the repo" fails | `SEULA_GH_TOKEN` is missing, expired, or has no Contents access |
| "Check out seula" fails | The seula repo isn't reachable: make it public, or allow access to it in its Actions settings |
| "Write the spec" fails to authenticate | `SEULA_ANTHROPIC_API_KEY` is missing or wrong (seula doesn't read a secret named `ANTHROPIC_API_KEY`) |
| The comment or label step warns | The token lacks Issues: Read and write |
| The pull request has no CI checks | The branch was pushed with `GITHUB_TOKEN` instead of `SEULA_GH_TOKEN` |
