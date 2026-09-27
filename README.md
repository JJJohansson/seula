# seula

> **seula** (Finnish: *sieve*): spec-driven quality gates for AI coding agents.

Coding agents make code cheap. They don't make being wrong cheap. seula puts a gate between
each step of a spec-driven workflow, so work moves on only when it meets its spec, and people
are pulled in only where their judgement is needed: approving the spec, and merging.

seula is independent of any project: a repo takes it into use with `seula init` when it needs
it, and keeps its own specs, tracker and CI.

```
Ticket ─G0─▶ Spec ─G1─▶ YOU APPROVE ─▶ Plan ─G2─▶ Build ─G3─▶ Verify ─G4─▶ YOU MERGE ─▶ Deploy ─G5
```

Each gate uses the cheapest check that can decide:

- **Scripts** for anything mechanical: spec format, criterion coverage, CI.
- **[Jev](https://docs.typesafe.ai/introduction)**, TypeSafe's decision model, for yes/no
  judgement. It returns calibrated probabilities, fast and cheaply, and can't make things up
  because it doesn't generate text.
- **A Claude reviewer in a fresh context** when Jev is unsure, and to write feedback.
- **You**, for intent (the spec) and the merge.

The full gate definitions are in [`docs/quality-gates.md`](docs/quality-gates.md).

## Status

| Gate | What | State |
|---|---|---|
| G0 | Is the ticket ready to write a spec from? | ✅ `seula gate g0` |
| G1 | Spec format rules + Jev per acceptance criterion | ✅ `seula gate g1` |
| — | Run files, loop limit, `seula status` | ✅ |
| — | Cut-off calibration from labeled examples | ✅ `seula calibrate` |
| — | Claude Code plugin: `seula-gates` skill, `seula-reviewer` agent, spec-writer prompt | ✅ |
| — | Tracker adapters: Jira and GitHub Issues (`seula tracker`) | ✅ |
| — | Reusable GitHub workflows: ticket → spec pull request, spec format check | ✅ (first real run pending) |
| — | `seula init`: adopt seula in any repo | ✅ |
| — | Design-first option (`design.required`) | ✅ |
| G2–G5 | Plan coverage, criterion citations, review, smoke check | Planned |
| — | Dashboard ([spec](specs/dashboard.md)) | Idea |

Each feature has a spec in [`specs/`](specs/). seula checks its own specs with its own gate.

## Adopting seula in a repo

From the repo's root (Node 22.18 or later):

```bash
npx github:JJJohansson/seula init --tracker github    # or --tracker jira; add --design-first to require designs
```

This writes `seula.config.json`, two short caller workflows that use seula's reusable workflows
(pinned to a seula version), and a spec template if the repo has none. It never overwrites your
files. Then add the secrets it lists and follow the setup guide for your tracker:

- [GitHub Issues](docs/setup-github-issues.md): add the `seula:ready-for-spec` label to an issue.
- [Jira](docs/setup-jira.md): move a ticket to *Ready for spec*.

Either way, the result is a pull request with the spec, the ticket and its comments, and every
gate result, and a comment on the ticket. A person approves the spec and merges.

When a run goes wrong, seula names the step that failed.
[Troubleshooting](docs/troubleshooting.md) has one entry for each step.

## Running the gates by hand

```bash
npx github:JJJohansson/seula gate g0 --ticket ticket.md --run WEB-42   # is the ticket ready?
npx github:JJJohansson/seula check-spec specs/my-feature.md             # format rules only
npx github:JJJohansson/seula gate g1 specs/my-feature.md --run WEB-42
npx github:JJJohansson/seula status
```

`gate g1` runs the format rules first; only a spec that passes them goes to Jev. Put your Jev
key in the environment or in a `.env` file as `TYPESAFE_API_KEY` (copy
[`.env.example`](.env.example), which also lists the tracker variables). Without a key, the Jev
checks are skipped (exit 0) with a message saying so.

Example output (numbers illustrative):

```
G1 · spec format · specs/export-csv.md
Result: PASS (0 errors, 0 warnings)

G1 · Jev · specs/export-csv.md  (jev-1.13.0, 500 tokens, $0.00002)
  criterion 1   pass   testable 0.94✓  unambiguous 0.91✓  behavior 0.97✓  inScope 0.98✓
  criterion 2   pass   testable 0.92✓  unambiguous 0.86✓  behavior 0.95✓  inScope 0.97✓
  criterion 3   pass   testable 0.95✓  unambiguous 0.88✓  behavior 0.93✓  inScope 0.96✓
  criterion 4   review testable 0.81✓  unambiguous 0.58?  behavior 0.90✓  inScope 0.94✓
  criterion 5   pass   testable 0.93✓  unambiguous 0.90✓  behavior 0.96✓  inScope 0.95✓
Result: REVIEW — 1 unsure
Feedback:
  criterion 4 · unambiguous: 0.58 → review
```

| Exit code | Meaning |
|---|---|
| 0 | Pass, or Jev skipped |
| 1 | Back: the writing agent should rework the listed criteria |
| 2 | Unsure: a reviewer or a person decides |
| 3 | Stop: the gate sent the work back too many times; a person steps in |
| 64 | Usage error |
| 70 | Internal error (for example the Jev API failed); nothing was decided |
| 77 | A service refused a credential (HTTP 401 or 403); the message names it, never its value |

## Claude Code plugin

seula is also a Claude Code plugin. The `seula-gates` skill tells an agent which gate to run
after each step and what each exit code means; the `seula-reviewer` agent (read-only, Opus)
decides unsure items and checks a change against its spec; `prompts/spec-writer.md` drives an
unattended spec run.

```
/plugin marketplace add JJJohansson/seula
/plugin install seula@seula
```

In CI, the reusable workflow loads it with `claude --plugin-dir`.

## Configuration

`seula init` writes `seula.config.json`; every setting has a default (see
[`seula.config.example.json`](seula.config.example.json) and `seula config` for the effective
values). The spec format defaults match [`templates/spec.md`](templates/spec.md): a `# FEATURE:`
title, a `> **Status:** …` line, and `OVERVIEW`, `ACCEPTANCE CRITERIA`, `OUT OF SCOPE` and
`EDGE CASES` sections, with criteria as a numbered list. Other settings: `specDir`, `ignore`,
`tracker` (type and state names), `design` (the design-first option), `maxBacks`, and the Jev
questions and cut-offs.

## Offline, CI and repeatable runs

- `--record answers.json` calls Jev and saves every answer.
- `--recorded answers.json` replays them without a key or network. Use it in tests, in CI for
  forks, and to re-run a calibration.

## Calibrating the cut-offs

Jev's probabilities are calibrated; your cut-offs should be too. Label real criteria as good or
bad per question and run:

```bash
seula calibrate .seula/calibration/labels.json --record .seula/calibration/answers.json
```

It reports false blocks, misses and how often it's unsure, for the current and the recommended
cut-offs, and prints the config to paste in. The label format is in
[`examples/calibration/labels.example.json`](examples/calibration/labels.example.json).

## Run files and status

With `--run <id>`, each gate result is appended to `.seula/runs/<id>.json`. The file travels
with the feature branch, so the gate history is part of what gets reviewed. `seula status`
shows every feature:

```
Waiting on you: 1

FEATURE  TITLE           STEP         GATES    NEXT
WEB-42   Export as CSV   spec review  G1 ↺✓    → you: approve spec
WEB-45   Dark mode       spec         G1 ↺     → agent
```

## Design choices

- **The agent that wrote something never checks it.**
- **Jev sits behind an interface** (`DecisionModel`), so it can be swapped or compared with
  another model on the same labeled examples.
- **Loops are bounded:** a gate sends work back at most twice before a person is asked.
- **No runtime dependencies.** Plain Node, `fetch` for the Jev API.

## Releasing

Adopting repos pin a seula version (`init` uses `v<package version>`). After changing seula,
bump `version` in `package.json` and push a matching tag, for example
`git tag v0.2.0 && git push origin v0.2.0`. Repos move to it by changing the `@ref` and
`seula-ref` in their caller workflows.

## Development

```bash
npm install        # also builds dist/
npm test           # Node's built-in test runner, running the TypeScript directly
npm run typecheck
npm run seula -- check-spec test/fixtures/good-spec.md
```
