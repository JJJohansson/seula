# FEATURE: Commit message check (commitlint)

> **Status:** Approved (26 Sep 2026), not yet built

## OVERVIEW
seula's own repo checks that every commit message follows
[Conventional Commits](https://www.conventionalcommits.org/), with
[commitlint](https://github.com/conventional-changelog/commitlint). CI runs the check on pull
requests and on pushes to `main`. A local git hook runs the same check before a commit is made.
This applies to the seula repo only; it adds nothing to the repos that adopt seula.

## WHY / INTENT
Every other part of seula is checked by a gate. Commit messages are the history a reviewer
and a changelog read, and today nothing checks them. A mechanical rule is a job for a script,
not for a person. The CI check is the gate, because a local hook can be skipped; the hook only
gives faster feedback.

## INPUTS / OUTPUTS
- Inputs: the commit messages of a pull request (base to head), of a push to `main` (before to
  after), or of the commit being made locally.
- Outputs: pass, or a failed check that names each bad commit and the rule it breaks.

## ACCEPTANCE CRITERIA
1. The rules are `@commitlint/config-conventional`, plus the type `spec` for changes that touch
   only specs.
2. seula's CI checks every commit in a pull request, from the base commit to the head commit,
   and fails when one message breaks a rule.
3. seula's CI checks every commit in a push to `main`, and fails when one message breaks a rule.
4. A local `commit-msg` git hook, installed by `npm install`, checks the message before the
   commit is made and stops a commit whose message breaks a rule.
5. `npm run commitlint` checks the last commit locally.
6. commitlint and the hook tool are devDependencies only. seula still has no runtime
   dependencies, and the published package doesn't contain them.
7. `CLAUDE.md` states the commit message format in its Git section.

## OUT OF SCOPE
- Checking commit messages in repos that adopt seula, or adding commitlint to `seula init`.
- The messages of the commits that the ticket-to-spec workflow makes in adopting repos.
- Generating a changelog or release notes from the commits.
- Rewriting the history that exists before this check.

## EDGE CASES
- The first push to a new branch has no "before" commit: CI checks the commits that are not on
  `main`.
- Merge commits and reverts made by GitHub: commitlint's default ignore rules apply.
- A `Co-Authored-By:` trailer is a footer and doesn't break the body rules.
- `npm install` in a checkout without `.git` (for example `npx github:…`) doesn't fail because
  the hook can't be installed.

## PLAN
1. devDependencies `@commitlint/cli`, `@commitlint/config-conventional` and `husky`;
   `commitlint.config.js` with the `spec` type; `.husky/commit-msg`.
2. Extend the `prepare` script so it installs the hook and still builds `dist/`, and skips the
   hook when there is no `.git`.
3. A `commitlint` job in `.github/workflows/ci.yml`, with `fetch-depth: 0`.
4. Verify: a bad message is rejected by the hook and by `npm run commitlint`; the existing three
   commits pass; CI fails on a test branch with a bad message.

---
Do not begin implementation until the acceptance criteria are confirmed.
