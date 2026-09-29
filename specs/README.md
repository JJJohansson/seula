# Specs

Specifications are the source of truth for what seula does. See
[`../SPEC_DRIVEN_DEVELOPMENT.md`](../SPEC_DRIVEN_DEVELOPMENT.md) for how we work with them, and
[`../docs/quality-gates.md`](../docs/quality-gates.md) for the gates as a whole. One spec per
feature. Only approved work (*Shipped / Active / Approved*) may be built.

seula is an independent, project-agnostic toolkit: nothing in these specs may depend on a
particular repo, tracker or app.

**A note on history:** the first version of seula was built from a design agreed in
conversation, before these specs existed. The *Active* specs below were written afterwards from
the implementation and its tests, and say so in their status line. A person confirmed their
criteria on 29 Sep 2026.

## Active
- [`g1-spec-gate.md`](g1-spec-gate.md): spec format rules, then Jev on every acceptance
  criterion (`seula check-spec`, `seula gate g1`).
- [`g0-ticket-gate.md`](g0-ticket-gate.md): is a ticket ready to write a spec from?
  (`seula gate g0`).
- [`run-files.md`](run-files.md): one JSON history per feature, the loop limit, `seula status`
  and `seula update`.
- [`calibration.md`](calibration.md): recommend Jev cut-offs from labeled examples
  (`seula calibrate`).
- [`agent-plugin.md`](agent-plugin.md): the Claude Code plugin: the `seula-gates` skill, the
  `seula-reviewer` agent, and the spec-writer and planner prompts.

## Approved and built
- [`trackers.md`](trackers.md) (approved 26 Sep 2026): Jira and GitHub Issues adapters behind
  one interface (`seula tracker`).
- [`ticket-to-spec-workflow.md`](ticket-to-spec-workflow.md) (approved 26 Sep 2026): the
  reusable ticket-to-spec and spec-check GitHub workflows.
- [`adoption.md`](adoption.md) (approved 26 Sep 2026): `seula init`, which sets seula up in any
  repo.
- [`design-first.md`](design-first.md) (approved 26 Sep 2026): optional setting that requires a
  linked design before a UI ticket gets a spec.
- [`board-sync.md`](board-sync.md) (approved 28 Sep 2026): a check that blocks merging a spec
  pull request while its ticket needs input, and a move to Planning when it is merged. The
  check ran for real on 29 Sep 2026, the move on merge not yet.
- [`g2-plan-gate.md`](g2-plan-gate.md) and [`spec-to-plan-workflow.md`](spec-to-plan-workflow.md)
  (approved 28 Sep 2026): when a spec pull request is merged, an agent writes the plan into the
  spec, G2 checks that it covers every criterion, and a person reviews it in a plan pull
  request. Built, with its caller from `init` and the docs; the first real run not yet.

## Approved, not yet built
- [`commit-messages.md`](commit-messages.md) (approved 26 Sep 2026): commitlint checks seula's
  own commit messages in CI and in a local git hook.
- [`security.md`](security.md) (approved 26 Sep 2026): the security bar for all of seula (supply
  chain, secrets, network) and its threat model. Criteria 1–2 met; the rest not yet.
- The ticket's part of a spec (approved 29 Sep 2026): when a ticket updates a spec that
  already exists, G1 and G2 check only the ticket's change (`--base`), the spec writer leaves
  the rest as it is, and `seula approve` keeps a buildable status. Not yet built. The changes
  are in
  [`g1-spec-gate.md`](g1-spec-gate.md) (criteria 18–20),
  [`g2-plan-gate.md`](g2-plan-gate.md) (criteria 2, 3 and 5),
  [`ticket-to-spec-workflow.md`](ticket-to-spec-workflow.md) (criteria 12, 15 and 29),
  [`spec-to-plan-workflow.md`](spec-to-plan-workflow.md) (criteria 4, 5, 7 and 15) and
  [`agent-plugin.md`](agent-plugin.md) (criteria 13–14 and 16–17).

## Ideas
- [`dashboard.md`](dashboard.md): a local web page of every feature in flight.
- [`round-extras.md`](round-extras.md): skip a ticket with nothing new, warn after many rounds,
  and show earlier rounds in the pull request. Split from change B; decide after B1.
- G3 criterion citations in tests, G4 review, G5 smoke check: described in
  [`../docs/quality-gates.md`](../docs/quality-gates.md); specs to be written before they are
  built.
