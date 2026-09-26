# FEATURE: Design-first option

> **Status:** Approved (26 Sep 2026)

## OVERVIEW
An optional setting that makes a ready design a precondition for writing the spec of any
ticket that changes the UI. When it is on, G0 asks whether the ticket changes a screen and
sends it back until it links an approved design; the spec writer then reads that design and
links it from the spec. The setting is off by default.

## WHY / INTENT
For UI work, a spec written from concrete screens and states has sharper criteria than one
written from a sentence. Some teams design first and some don't, so seula makes it a choice
per repo rather than a rule. The goal still comes first: G0 checks the goal before it asks for a
design, so a design never gets ahead of an agreed problem.

## INPUTS / OUTPUTS
- Inputs: `design.required` (default `false`) and `design.linkPatterns` (default:
  `docs/design/` and `figma.com/`) in `seula.config.json`; the ticket text.
- Outputs: G0 asks and notes about the design; `links.design` in the run file; a
  `## DESIGN` section in the spec.

## ACCEPTANCE CRITERIA
1. When `design.required` is `false`, G0 and the spec writer behave exactly as without this
   feature.
2. When `design.required` is `true`, G0 adds the question `uiChange`: "Does the ticket add a
   screen, or change what a screen shows or how it is laid out?"
3. When `uiChange` passes and the ticket text contains no match for any `design.linkPatterns`
   entry, G0 returns back with the ask "This ticket changes the UI. Link the approved design
   before a spec is written."
4. When `uiChange` is unsure, G0 returns unsure with the note "A person must decide whether this
   ticket needs a design."
5. When the ticket contains a design link, G0 stores the first match in the run file as
   `links.design`, and does not ask for a design.
6. The goal and contradiction questions are asked in the same request, so a ticket without a
   clear goal goes back for its goal first, whatever its design status.
7. When the run has a design link, the spec-writer prompt tells the agent to read the design
   when it is a file in the repo, to write criteria for the screens and states it shows, and to
   add a `## DESIGN` section that links it. A link outside the repo is linked but not read.
8. `seula init --design-first` turns the setting on (see [`adoption.md`](adoption.md)).

## OUT OF SCOPE
- Creating designs; people or other tools do that.
- Reading designs from Figma or other tools in CI (they need their own credentials).
- Checking that the built UI matches the design (a later G4 reviewer task with screenshots).

## EDGE CASES
- The ticket links a design, but the ticket doesn't change the UI: the link is stored and the
  spec links it; nothing is sent back.
- The design link points to a repo path that doesn't exist: the spec writer adds it to the
  spec's open questions, and the run becomes `needs_input`.

## PLAN
1. `design` section in `config.ts`; the `uiChange` question with a new `onFail` kind that
   checks for a link instead of routing on the answer alone.
2. `links.design` in the run file; `{{DESIGN}}` in the spec-writer prompt.
3. Tests: setting off (no extra question), UI ticket without link, with link, unsure, non-UI
   ticket with link.
