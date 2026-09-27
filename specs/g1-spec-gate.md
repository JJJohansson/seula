# FEATURE: G1 spec gate

> **Status: Active.** Written after the first implementation (26 Sep 2026); confirm the criteria. Credential errors: criterion 17 approved 27 Sep 2026, not built.

## OVERVIEW
A command that checks one feature spec before it moves on to planning: first deterministic
format rules, then, when the format passes, Jev yes/no questions on every acceptance criterion.
It tells the writing agent what to fix, and tells a person when it can't decide.

## WHY / INTENT
Agents write specs fast. A vague or unfinished criterion becomes wrong code later. Checking each
criterion before anyone builds catches that cheaply, and saves people's attention for approving
intent.

## INPUTS / OUTPUTS
- Inputs: a spec file; an optional ticket file; `seula.config.json`; `TYPESAFE_API_KEY` or a
  recording file.
- Outputs: a text or JSON report; an exit code (see `docs/quality-gates.md`); a G1 event in the
  run file when `--run` is given.

## ACCEPTANCE CRITERIA
1. `seula check-spec <file>` reports an error when the spec has no `# ` title line.
2. It reports an error when the spec has no `> **Status:** …` line, or when the status is not in
   the configured list of statuses.
3. It reports an error for each configured required section that is missing or empty. A heading
   matches when it starts with the required name after text in parentheses is removed, so
   `OUT OF SCOPE (v1)` matches `OUT OF SCOPE`.
4. It reports an error when the acceptance criteria section has no numbered item, and for each
   criterion shorter than three words.
5. It reports an error when two criteria have the same number, and one warning that lists the
   missing numbers. Criteria listed out of numeric order produce no finding.
6. It reports an error for each line, outside fenced code and inline code, that contains a
   configured placeholder pattern (default: `TBD`, `TODO`, `???`, `FIXME`, `lorem ipsum`) or an
   unfilled template slot (angle brackets around text that contains a space).
7. It reports an error when the criteria heading contains `DRAFT` and the status is buildable.
8. It reports an info note, not an error, when the status is not buildable.
9. `check-spec` exits 0 when no file has an error and 1 otherwise. It accepts several files and
   skips the files in the configured `ignore` list, reporting how many it skipped.
10. `seula gate g1 <file>` runs the format rules first and calls Jev only when they pass.
11. For each criterion, Jev receives one request that contains the spec title, overview, intent,
    out-of-scope list, the ticket text when given, and the criterion, with the configured
    questions (default: `testable`, `unambiguous`, `behavior`, `inScope`).
12. Each answer routes to pass when its score is at or above `passAt`, back when it is below
    `blockBelow`, and unsure otherwise. The score is the probability of "yes", or 1 minus it for
    a question marked `good: "no"`. Per-question cut-offs in the config replace the defaults
    (0.75 and 0.25).
13. The gate result is the worst question result: any back gives back (exit 1); otherwise any
    unsure gives unsure (exit 2); otherwise pass (exit 0).
14. Each question that does not pass produces one feedback line in the form
    `criterion <n> · <question>: <score> → <result>`.
15. Without `TYPESAFE_API_KEY` and without `--recorded`, the Jev half is reported as skipped and
    the command exits 0.
16. `--record <file>` saves every Jev answer; `--recorded <file>` replays them without network
    access, and the command exits 70 when an answer is missing from the recording.
17. When Jev answers HTTP 401 or 403, the command exits 77. Its message names
    `TYPESAFE_API_KEY` and says that the key may be expired or revoked. It never prints the
    key's value.

## OUT OF SCOPE
- Rewriting criteria; the writing agent does that.
- Explaining a failure beyond the question name and score.
- Checking guardrail documents that don't follow the feature template (use `ignore`).

## EDGE CASES
- A spec with no criteria: a format error, and Jev is not called.
- Jev answers HTTP 429 or 529: two retries with backoff; 401 and 403 exit 77 (criterion 17);
  any other HTTP error exits 70.
- Windows line endings parse the same as Unix line endings.
