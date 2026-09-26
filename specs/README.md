# Specs

Specifications are the source of truth for what seula does. See
[`../SPEC_DRIVEN_DEVELOPMENT.md`](../SPEC_DRIVEN_DEVELOPMENT.md) for how we work with them, and
[`../docs/quality-gates.md`](../docs/quality-gates.md) for the gates as a whole. One spec per
feature. Only approved work (*Shipped / Active / Approved*) may be built.

seula is an independent, project-agnostic toolkit: nothing in these specs may depend on a
particular repo, tracker or app.

**A note on history:** the first version of seula was built from a design agreed in
conversation, before these specs existed. The *Active* specs below were written afterwards from
the implementation and its tests, and say so in their status line. Their criteria still need
confirming by a person.

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
  `seula-reviewer` agent, and the spec-writer prompt.

## Approved (26 Sep 2026), being built in this order
- [`trackers.md`](trackers.md): Jira and GitHub Issues adapters behind one interface
  (`seula tracker`).
- [`ticket-to-spec-workflow.md`](ticket-to-spec-workflow.md): the reusable ticket-to-spec and
  spec-check GitHub workflows.
- [`adoption.md`](adoption.md): `seula init`, which sets seula up in any repo.
- [`design-first.md`](design-first.md): optional setting that requires a linked design before a
  UI ticket gets a spec.
- [`commit-messages.md`](commit-messages.md): commitlint checks seula's own commit messages in
  CI and in a local git hook. Not yet built.

## Ideas
- [`dashboard.md`](dashboard.md): a local web page of every feature in flight.
- [`security.md`](security.md): the security bar for all of seula (supply chain, secrets,
  network) and its threat model.
- G2 plan coverage, G3 criterion citations in tests, G4 review, G5 smoke check: described in
  [`../docs/quality-gates.md`](../docs/quality-gates.md); specs to be written before they are
  built.
