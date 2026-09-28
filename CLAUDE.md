# CLAUDE.md

Guidance for Claude Code in this repository.

## Spec-driven development (read first)

This project uses spec-driven development. Invoke the `spec-driven-development` skill before
any non-trivial work. `specs/` is the source of truth for behavior; the repo's settings for the
skill are in `SPEC_DRIVEN_DEVELOPMENT.md`. `docs/quality-gates.md` is the cross-cutting
description of the gates; keep it in step with the specs.

## Commands

```bash
npm install        # also builds dist/ (prepare script)
npm test           # node:test over test/**/*.test.ts, TypeScript run directly by Node
npm run typecheck  # tsc --noEmit
npm run build      # tsc → dist/
npm run seula -- <command>   # run the CLI from source
```

Node 22.18 or later: Node runs the TypeScript sources directly (type stripping), so the source
may use only erasable syntax (no enums, namespaces or parameter properties), and relative imports
end in `.ts`.

## Architecture

- `src/cli.ts`: argument parsing, exit codes, output formatting. No gate logic.
- `src/spec.ts`: markdown spec parser. `src/gates/checkSpec.ts`: G1 format rules.
- `src/gates/jevSpec.ts` (G1) and `src/gates/jevTicket.ts` (G0): build Jev requests, route answers.
- `src/routing.ts`: pass / back / unsure from a probability and cut-offs.
- `src/jev/model.ts`: the `DecisionModel` interface, the Jev HTTP client, and record/replay.
  Gates depend only on the interface.
- `src/runs.ts`, `src/status.ts`: run files and the status table.
- `src/calibrate.ts`: cut-off recommendation from labeled examples.
- `src/trackers/`: the `Tracker` interface and the Jira and GitHub Issues adapters.
- `src/prompts.ts`: renders `prompts/spec-writer.md` and `prompts/planner.md` for a run. `src/init.ts`: `seula init`.
- `.github/workflows/ticket-to-spec.yml`, `spec-check.yml`, `board-sync.yml`: the reusable workflows
  adopting repos call; `templates/workflows/`: the caller workflows `init` writes. `ci.yml`: seula's own CI.
- `skills/`, `agents/`, `prompts/`, `.claude-plugin/`: the Claude Code plugin.

## Conventions

- seula is project-agnostic: no code, default or example may depend on a particular repo,
  tracker or app.
- No runtime dependencies.
- Exit codes are part of the contract: 0 pass or skipped, 1 back, 2 unsure, 3 loop limit,
  64 usage, 70 internal error, 77 a service refused a credential.
- Tests never call the real Jev API; use `FakeModel` or a recording.
- Agent-facing text (skill, agent, prompts, Jev questions) uses short sentences with one
  instruction each, in the style of the `asd-ste100` skill.

## Git

- `git add` and `git commit`: allowed without asking.
- `git push` and `git pull`: ask first, every time.
