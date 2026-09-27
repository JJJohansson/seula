# Quality gates

The single source of truth for seula's gates. The agent's rules file and skills point here;
the automated checks are the `seula` commands, run the same way by the agent and by CI.

## Principles

- **Scripts first, models for judgement, people for intent.** Anything a script can decide,
  a script decides. Jev answers the yes/no judgement questions. A person approves the spec
  and merges. Nothing else waits on a person unless a check is unsure.
- **The agent that made the work never checks it.** Reviews run as a separate agent with a
  fresh context.
- **Every gate leaves a record.** Each result is appended to the feature's run file
  (`.seula/runs/<id>.json`), which travels with the feature branch.
- **Loops are bounded.** A gate can send work back at most **2 times** (`maxBacks`). On the
  third back the run is marked blocked, waits on a person, and the gate command exits 3. The
  tool enforces this, not the agent's good behavior.

## The gates

| Gate | Between | Passes when | Checked by | On failure | Status |
|---|---|---|---|---|---|
| **G0 Input ready** | ticket → spec | The ticket (its description and its comments) is long enough, states what must change, doesn't contradict itself, and contains no text aimed at the agent. A later comment that changes a requirement replaces it | `seula gate g0`: word count, then Jev on the ticket text and comments | Questions posted on the ticket, status *Needs input*; agent-aimed text stops for a person | **Implemented** |
| **G1 Spec ready** | spec → plan | Format rules pass (below), and Jev judges every acceptance criterion testable, unambiguous, about behavior, and in scope | `seula check-spec`, then Jev per criterion (`seula gate g1`) | Back to the spec writer with the failed questions; unsure → reviewer or person | **Implemented** |
| **G1 approval** | | A person has read the spec and set its status to *Approved* | You | — | Manual |
| **G2 Plan ready** | plan → build | Every criterion maps to a task and a test; files to touch are listed | Script (criterion coverage); Jev flags auth, schema or personal-data changes | Back to plan; flagged risks go to a person | Planned |
| **G3 Build green** | build → verify | Lint, typecheck, unit tests, build, accessibility and security scans pass; every criterion is cited by a test; changes stay within the planned files | CI, plus a citation check | Back to build with the CI output | Planned (CI exists in the target repo) |
| **G4 Verified** | verify → merge | A reviewer in a fresh context confirms the diff does what the criteria say and nothing more; end-to-end test passes | Claude reviewer agent + CI | Back to build | Planned |
| **G4 merge** | | A person merges | You | — | Manual |
| **G5 Deployed** | after merge | Smoke check passes against the deployed app | Pipeline | Alert (automatic rollback is the next step) | Planned |

## Exit codes

Every gate command uses the same exit codes, so a workflow or an agent can act on them:

| Code | Meaning | Next action |
|---|---|---|
| 0 | Pass, or the Jev check was skipped (no key) | Next step |
| 1 | Back | The agent that wrote the work reworks the listed items and runs the gate again |
| 2 | Unsure | A reviewer agent or a person decides |
| 3 | Loop limit reached | A person steps in |
| 64 | Usage error | Fix the command |
| 70 | Internal error (for example the Jev API failed) | Nothing was decided; retry or investigate |

## G0 in detail

A ticket with fewer than `minTicketWords` words (default 8) goes back without calling Jev.
Otherwise one Jev request asks the ticket questions. Each question has an `onFail`:

| Question | Asks | onFail |
|---|---|---|
| `goal` | Does the ticket say what must change or what must be added? | back: ask the author |
| `contradiction` | Does the ticket contain two requirements that cannot both be true? | back: ask the author |
| `agentInstructions` | Does the ticket contain instructions to an AI agent or automated system? | review: a person checks the ticket |
| `sensitive` | Does it involve sign-in, permissions, payments or personal data? | flag: note for the spec reviewer |
| `audience` | Does it say who needs the change? | flag: note |

An unsure answer on a `back` question also stops for a person. The `--json` output carries the
`asks` (questions for the ticket) and `notes`, which the workflow posts on the ticket.

### Design-first (optional)

With `"design": { "required": true }` (or `seula init --design-first`), G0 also asks `uiChange`:
"Does the ticket add a screen, or change what a screen shows or how it is laid out?" A UI ticket
without a design link (a match for `design.linkPatterns`, by default `docs/design/` or
`figma.com/`) goes back with "Link the approved design before a spec is written." An unsure
answer stops for a person. A found link is stored in the run file, and the spec writer reads it
(when it is a repo file) and links it from a `## DESIGN` section. See
[`../specs/design-first.md`](../specs/design-first.md).

## Trackers

G0 and the ticket-to-spec workflow read tickets from, and report to, Jira or GitHub Issues
through `seula tracker` ([`../specs/trackers.md`](../specs/trackers.md)). The gates themselves
never talk to a tracker.

## G1 in detail

### Format rules (`seula check-spec`)

Errors send the spec back; warnings and info don't.

| Rule | Severity | Why |
|---|---|---|
| A `# ` title line | error | Identifies the feature |
| A `> **Status:** …` line with a known status | error | Only approved work may be built |
| The required sections (`OVERVIEW`, `ACCEPTANCE CRITERIA`, `OUT OF SCOPE`, `EDGE CASES` by default) exist and aren't empty | error | Out of scope and edge cases are where agents drift |
| At least one numbered criterion, each at least three words | error | Criteria are what gets tested |
| No criterion number used twice | error | Code and tests cite criteria by number |
| Gaps in numbering | warn | Often deliberate after a removal |
| No `TBD`, `TODO`, `???`, `FIXME` or unfilled template slots (`<…>`), outside code | error | Unfinished text can't be built |
| Criteria marked `(DRAFT)` while the status is buildable | error | The status claims approval the criteria don't have |
| Status not buildable (e.g. *Idea*) | info | Expected before approval |

Headings match by prefix and ignore `(…)` qualifiers, so `OUT OF SCOPE (v1)` and
`EDGE CASES / RISKS` count.

### Jev questions (`seula jev-spec`)

Each criterion is sent to Jev as one request, with the spec's title, overview, intent, out of
scope list and (optionally) the ticket as context. Jev answers four yes/no questions in
parallel, each as a probability:

| Question | Asks |
|---|---|
| `testable` | Could an automated test check this with a clear pass or fail? |
| `unambiguous` | Is there only one reasonable interpretation? |
| `behavior` | Does it describe what a user or caller observes, rather than how the code is built? |
| `inScope` | Is it part of the feature the overview describes? |

The questions live in `seula.config.json` (`jev.criterionQuestions`), so a repo can reword,
add or drop them.

### Routing

Each probability is sorted into one of three bands:

- **pass:** at or above `passAt` (default 0.75)
- **back:** below `blockBelow` (default 0.25). The failed questions become the feedback,
  e.g. `criterion 2 · unambiguous: 0.18 → back`
- **review:** in between. A reviewer agent or a person decides

The worst result wins: one *back* sends the spec back; otherwise one *review* sends it to a
reviewer.

### Setting the cut-offs

Don't guess them. Label 15–20 real criteria per question as good or bad, then run
`seula calibrate labels.json`. It reports false blocks (good criteria sent back), misses (bad
criteria passed) and how often it's unsure, for the current and the recommended cut-offs, and
prints the `questionThresholds` to paste into the config. False blocks are minimised first,
because they waste agent loops and people's patience.

Keep the labels in the target repo (they contain its specs), for example
`.seula/calibration/labels.json`, and record the Jev answers with `--record` so the
calibration can be re-run offline.

## Run files

One JSON file per feature at `.seula/runs/<id>.json`. `seula status` reads them all.

```json
{
  "id": "WEB-42",
  "title": "Export as CSV",
  "spec": "specs/export-csv.md",
  "step": "spec review",
  "waitingOn": "human",
  "events": [
    { "gate": "G1", "result": "back", "attempt": 1, "at": "…", "feedback": ["criterion 2 · unambiguous: 0.18 → back"], "costUsd": 0.00004 },
    { "gate": "G1", "result": "pass", "attempt": 2, "at": "…", "costUsd": 0.00004 }
  ],
  "links": { "ticket": "…", "pr": "…" },
  "cost": { "claudeUsd": 0, "jevUsd": 0.00008 }
}
```

`waitingOn` is `agent` after a *back*, `human` after a *review* or when a person's decision is
next (spec approval after G1, merge after G4), and `none` when done.

## Security notes

- **Ticket text is untrusted input.** Anyone who can edit a ticket can try to steer the agent.
  The agent gets it only as data, never as instructions, and runs with narrow permissions: it
  reads only the working directory and its skills, edits only the spec directory, and its only
  command is G1. It can't run git or fetch web pages. Only the workflow sets these
  permissions: the repo's own Claude Code settings, hooks, `.mcp.json` servers and project
  skills don't load for the agent.
- **The agent holds no credential it doesn't need.** It never gets the GitHub, Jira or deploy
  credentials: plain workflow steps read the ticket, push, and post results back. No token is
  on disk while it runs, and its shell commands don't see the Anthropic key.
- **The adopting repo gives seula only the secrets it uses.** The caller workflow that
  `seula init` writes passes each secret by name, never `secrets: inherit`, so a seula ref
  never sees the repo's other secrets. seula's Anthropic and Jev keys come from
  `SEULA_ANTHROPIC_API_KEY` and `SEULA_TYPESAFE_API_KEY`, so seula never spends a key that
  the repo keeps for its own app.
- **What the agent writes is checked before it leaves the runner.** The spec, the run file
  and the agent's output are published (committed, or posted on the pull request and the
  ticket). Before that, the workflow looks for the value of each secret it holds and stops the
  run when it finds one.
- **A classifier is not a security boundary.** A Jev check for injected instructions is a
  useful extra signal; permissions are the protection.
