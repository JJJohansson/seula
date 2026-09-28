# Running the gates yourself

The workflows run the gates for you. You can also run them by hand, on your own machine or in
your own agent, with the `seula` command: `npx github:JJJohansson/seula <command>`, or
`npm run seula -- <command>` in a checkout of seula. Node 22.18 or later.

## The gates

```bash
seula gate g0 --ticket ticket.md --run WEB-42          # is the ticket ready to write a spec from?
seula check-spec specs/my-feature.md                   # G1's format rules only, no model
seula gate g1 specs/my-feature.md --run WEB-42         # format rules, then Jev on each criterion
seula gate g2 specs/my-feature.md --run WEB-42         # the plan in ## PLAN covers every criterion
seula status                                           # every feature, its step, and who it waits on
```

`gate g1` runs the format rules first; only a spec that passes them goes to Jev. `gate g2` runs
its plan rules first; only a plan that passes them gets Jev's flag questions. With
`--approved <file>`, G2 also checks that nothing outside `## PLAN` and the status line changed.

Put your Jev key in the environment or in a `.env` file as `TYPESAFE_API_KEY` (copy
[`.env.example`](../.env.example), which also lists the tracker variables). Without a key, the
Jev checks are skipped (exit 0), and the output says so.

Example output (numbers illustrative):

```
G1 · spec format · specs/export-csv.md
Result: PASS (0 errors, 0 warnings)

G1 · Jev · specs/export-csv.md  (jev-1.13.0, 500 tokens, $0.00002)
  criterion 1   pass   testable 0.94✓  unambiguous 0.91✓  behavior 0.97✓  inScope 0.98✓
  criterion 2   pass   testable 0.92✓  unambiguous 0.86✓  behavior 0.95✓  inScope 0.97✓
  criterion 3   review testable 0.81✓  unambiguous 0.58?  behavior 0.90✓  inScope 0.94✓
Result: REVIEW — 1 unsure
Feedback:
  criterion 3 · unambiguous: 0.58 → review
```

Every gate uses the same exit codes: 0 pass or skipped, 1 back, 2 unsure, 3 loop limit reached,
64 usage error, 70 internal error, 77 a service refused a credential. What each one means, and
what to do next, is in [quality gates](quality-gates.md#exit-codes).

## In Claude Code

seula is also a Claude Code plugin:

```
/plugin marketplace add JJJohansson/seula
/plugin install seula@seula
```

- The `seula-gates` skill tells your agent which gate to run after each step, and what each
  exit code means.
- The `seula-reviewer` agent (read-only, Opus) decides unsure criteria and checks a change
  against its spec.
- `prompts/spec-writer.md` and `prompts/planner.md` are the prompts that the workflows give the
  spec writer and the planner. `seula prompt spec-writer` and `seula prompt planner` render them.

In CI, the reusable workflows load the plugin with `claude --plugin-dir`.

## Recorded answers

- `--record answers.json` calls Jev and saves every answer.
- `--recorded answers.json` replays them without a key or network access. Use it in tests, in
  CI for forks, and to re-run a calibration.

## Calibrating the cut-offs

Jev's probabilities are calibrated; your cut-offs should be too. Label real criteria as good or
bad for each question, then run:

```bash
seula calibrate .seula/calibration/labels.json --record .seula/calibration/answers.json
```

It reports false blocks, misses and how often it is unsure, for the current and the
recommended cut-offs, and prints the config to paste in. The label format is in
[`examples/calibration/labels.example.json`](../examples/calibration/labels.example.json).

## Commands the workflows use

You rarely need these by hand, but they work locally too:

- `seula tracker key --branch seula/meal-4` prints the ticket key and run id from a seula
  branch name, with no tracker call.
- `seula tracker state --key MEAL-4 [--fail-on needsInput]` reads the ticket's state; the
  board sync check uses it.
- `seula tracker move --key MEAL-4 --state planning` moves a ticket (`needsInput`,
  `specReview` or `planning`).
- `seula approve specs/my-feature.md --pr 142` marks a merged spec *Approved* in its status line.

## Run files and status

With `--run <id>`, each gate result is added to `.seula/runs/<id>.json`. The file travels with
the feature's branch, so the gate history is part of what gets reviewed. `seula status` shows
every feature:

```
Waiting on you: 1

FEATURE  TITLE           STEP         GATES    NEXT
WEB-42   Export as CSV   spec review  G1 ↺✓    → you: approve spec
WEB-45   Dark mode       spec         G1 ↺     → agent
```

A gate sends work back at most twice (`maxBacks`); the third back stops it for a person.

## Configuration

`seula init` writes `seula.config.json`. Every setting has a default: see
[`seula.config.example.json`](../seula.config.example.json), and `seula config` for the values in
effect. The spec format defaults match [`templates/spec.md`](../templates/spec.md): a
`# FEATURE:` title, a `> **Status:** …` line, and the sections `OVERVIEW`,
`ACCEPTANCE CRITERIA`, `OUT OF SCOPE` and `EDGE CASES`, with the criteria as a numbered list.

Other settings: `specDir`, `ignore`, `tracker` (the type and the state names, including the
optional `planning`), `design` (the design-first option), `maxBacks`, the Jev questions and
cut-offs (`jev`), and G2's flag questions (`g2`).
