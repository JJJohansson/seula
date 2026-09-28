# FEATURE: G2 plan gate

> **Status:** Approved (28 Sep 2026). Unit 1 built 28 Sep 2026: the script rules (criteria 1–5), and the result without Jev (criteria 8–9). The Jev flags and the run file (criteria 6–7, 9–10) not yet.

## OVERVIEW
A command, `seula gate g2 <spec>`, that checks the plan in an approved spec's `## PLAN` section
before anyone builds. Script rules check that every acceptance criterion is covered by a task
with a test and files. Then Jev asks flag questions that point a person at risky areas. The
planning agent runs it in its loop, and the spec-to-plan workflow runs it again with Jev
([`spec-to-plan-workflow.md`](spec-to-plan-workflow.md)).

## WHY / INTENT
A plan that skips a criterion, or has no test for it, becomes code that doesn't do what the
spec says. Coverage is cheap and exact to check by script, so a script does it, not a model.
Some changes deserve a person's eyes before anyone builds them: sign-in, stored data and
personal data. Jev flags them. A flag never sends the plan back; it tells the reviewer where to
look. The gate also checks that the plan changed nothing else in the spec, because merging the
spec pull request approved the rest of it.

## INPUTS / OUTPUTS
- Inputs: a spec file with a `## PLAN` section; an optional `--approved <file>`, the spec as it
  was merged; `seula.config.json`; `TYPESAFE_API_KEY` or a recording file; `--run <id>`.
- Outputs: a text or JSON report; an exit code (see `docs/quality-gates.md`); a G2 event in the
  run file when `--run` is given.

## DATA SCHEMA
- The plan: a `## PLAN` section with a numbered list of tasks. Each task names, anywhere in
  its item, `Criteria:` (criterion numbers, separated by commas, or ranges such as `2-4`),
  `Test:` (the test that proves it) and `Files:` (the paths it changes or adds, separated by
  commas). For example:
  `1. Add the description meta tag. Criteria: 1, 2. Test: client/index.test.ts "criterion 1:
  the page has a description". Files: client/index.html.`
- Config: `g2.questions`, the flag questions, each with its `instructions`, its `criteria`
  and optional `passAt` (default 0.75). Defaults: `signIn` (sign-in, sessions or permissions),
  `storedData` (stored data or the database schema) and `personalData` (personal data).

## ACCEPTANCE CRITERIA
1. `seula gate g2 <spec>` reports an error when the spec has no `## PLAN` section, or when the
   section has no numbered task.
2. It reports an error for each task that has no `Criteria:` with a criterion number, no
   `Test:` with text, or no `Files:` with a path.
3. It reports an error for each acceptance criterion that no task names in `Criteria:`, and for
   each number in a `Criteria:` that is not an acceptance criterion of the spec.
4. It reports an error for each path in `Files:` that is absolute or contains `..`.
5. With `--approved <file>`, it reports an error when the spec differs from that file outside
   the `## PLAN` section and the status line. The error names the first section that differs.
6. It calls Jev only when criteria 1–5 find no error. One request holds the spec's title,
   overview and acceptance criteria and the plan, with the flag questions from `g2.questions`.
7. A flag question passes when the probability of "yes" is at most 1 minus its `passAt`.
   Otherwise it is a flag. A flag never sends the plan back.
8. The gate result is back (exit 1) when criteria 1–5 find an error, else unsure (exit 2) when
   there is a flag, else pass (exit 0). Each error and each flag produces one feedback line:
   `plan · <rule or question>: <detail>`.
9. Without `TYPESAFE_API_KEY` and without `--recorded`, the Jev half is reported as skipped,
   and the command exits 0 when criteria 1–5 find no error. `--record` and `--recorded` work as
   for G1, and a refused Jev key exits 77 ([`g1-spec-gate.md`](g1-spec-gate.md) criteria
   16–17).
10. With `--run <id>`, the result is added to the run file as a G2 event, and the loop limit
    applies to it ([`run-files.md`](run-files.md) criteria 1 and 5).

## OUT OF SCOPE
- Judging whether a task is well chosen, or whether its test really proves the criterion.
  G4 reviews the code against the spec.
- Checking that the listed files exist: a plan can add files.
- Estimating effort or ordering the tasks.
- Plans kept in a separate file.

## EDGE CASES
- A task item that wraps over several lines: its labels are read from the whole item.
- Text in `## PLAN` that is not a numbered item, such as a short introduction or a `###`
  heading: it is allowed and not checked.
- A criterion named by two tasks: allowed.
- `Criteria: 2-4` names 2, 3 and 4. A range whose end is below its start is an error.
- A spec with no acceptance criteria: criterion 3 has nothing to cover, and G1 has already
  reported the missing criteria.
- Windows line endings parse the same as Unix line endings.
