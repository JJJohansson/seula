# seula

> **seula** (Finnish: *sieve*): spec-driven quality gates for AI coding agents.

Coding agents make code cheap. They don't make being wrong cheap. seula turns a tracker ticket
into an agreed spec, and puts a gate between each step, so work moves on only when it meets its
spec. People are pulled in only where their judgement is needed.

```
Ticket ─G0─▶ Spec ─G1─▶ you merge = approve ─▶ Plan ─G2─▶ Build ─G3─▶ Verify ─G4─▶ you merge ─▶ Deploy ─G5
```

Each gate uses the cheapest check that can decide: **scripts** for anything mechanical,
**[Jev](https://docs.typesafe.ai/introduction)** (a judge model that answers yes/no questions
with a probability, and generates no text) for judgement, and **you** for intent and the merge.
The agent that writes something never checks it.

## What you get

- **A spec pull request from a ticket.** Move a Jira ticket to *Ready for spec* (or label a
  GitHub issue), and a Claude agent writes the spec in a sandbox. G0 checks the ticket first, G1
  checks every acceptance criterion, and unclear tickets get questions instead of guesses.
- **A board that follows the work.** A check blocks merging a spec while its ticket needs input,
  and merging the spec moves the ticket to *Planning*.
- **A plan pull request.** Merging the spec approves it. An agent then maps every criterion to a
  task, a test and files, G2 checks the coverage, and a person reviews the plan.
- **Your own tools.** seula runs in GitHub Actions and in Claude Code, and keeps no state outside
  your repo and your tracker.

How it all fits together, what runs where and how it is secured:
[**docs/how-it-works.md**](docs/how-it-works.md).

## Quick start

From the root of your repo (Node 22.18 or later). seula has no release yet, so pin a commit of
seula with `--seula-ref`:

```bash
git ls-remote https://github.com/JJJohansson/seula main    # the latest commit SHA
npx github:JJJohansson/seula init --tracker jira --seula-ref <commit SHA>    # or --tracker github
```

`init` writes `seula.config.json` and short caller workflows that use seula's reusable
workflows. It never overwrites your files. Then add the secrets it lists, and follow the setup
guide for your tracker: [Jira](docs/setup-jira.md) or [GitHub Issues](docs/setup-github-issues.md).

## Status

| | State |
|---|---|
| G0 ticket gate, G1 spec gate, ticket → spec pull request | ✅ Running in a real repo |
| Board sync (merge block, move to Planning) | ✅ Built; first real run pending |
| G2 plan gate, planner prompt | ✅ Built |
| Plan workflow (spec → plan pull request) | ✅ Built; first real run pending |
| G3 build, G4 review, G5 deploy check | Planned |

Each feature has a spec in [`specs/`](specs/), and seula checks its own specs with its own gate.

## Docs

- [How it works](docs/how-it-works.md): the flow, what runs where, security, and use ticket by
  ticket.
- Setup: [Jira](docs/setup-jira.md) · [GitHub Issues](docs/setup-github-issues.md) ·
  [Troubleshooting](docs/troubleshooting.md).
- [Running the gates yourself](docs/cli.md): the commands, the Claude Code plugin, recorded
  answers, calibration, run files and configuration.
- [Quality gates](docs/quality-gates.md): every gate, its questions and its exit codes.

## Contributing

```bash
npm install        # also builds dist/
npm test           # Node's built-in test runner, on the TypeScript directly
npm run typecheck
```

seula is built with spec-driven development: a spec first, then tests, one pull request per
unit. See [`CLAUDE.md`](CLAUDE.md) for the conventions. It has no runtime dependencies.
