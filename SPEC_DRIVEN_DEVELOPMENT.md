# Project configuration — spec-driven-development

This file personalizes the globally installed
[`spec-driven-development`](https://github.com/JJJohansson/spec-driven-development-skill)
skill to seula. The skill holds the principles, the workflow and the status definitions;
this file holds what's specific to this repo. **Where this file and the skill disagree on a
convention, this file wins.**

> **Setup status:** ✅ Configured for seula

---

## Spec location & naming
- **Directory:** [`specs/`](specs/)
- **Filename convention:** one spec per feature, `specs/<feature-name>.md` (no `spec-` /
  `adr-` / `ref-` prefixes).
- **Index:** [`specs/README.md`](specs/README.md).
- **Index grouping axis:** Status.

## Documentation categories (this repo)
- **Domains:** not used; specs carry no YAML frontmatter.
- **Filename prefixes:** none.

## Plans location
- Inline in the spec, under `## PLAN`.

## Project guardrails
- [`docs/quality-gates.md`](docs/quality-gates.md): what each gate checks and how results
  route. Every gate spec must agree with it.
- [`CLAUDE.md`](CLAUDE.md): stack, commands, conventions.

## Verification commands
- **Type check:** `npm run typecheck`
- **Unit + CLI tests:** `npm test` (Node's built-in test runner; offline; Jev is faked or
  replayed from recordings)
- **Self-check:** `npm run seula -- check-spec specs/*.md` (seula's G1 format rules on its
  own specs)
- **Build:** `npm run build`

## Activation
The "Spec-driven development" section of [`CLAUDE.md`](CLAUDE.md).

## Overrides (this file wins over the skill)
- **Status is a one-line marker, not frontmatter.** Every spec opens with a
  `> **Status:** …` line under its title: `Shipped` · `Active` · `Approved` · `Idea`, with an
  optional qualifier. Only approved work (*Shipped / Active / Approved*) may be built.
- **Specs written after the code say so** in the status line ("Written after the first
  implementation"), so a person knows the criteria still need confirming.
- **The pull request is the unit of "ship together".** A PR that changes behavior updates
  the matching spec and `docs/quality-gates.md` in the same PR.
- **Tests cite criteria** in their names, e.g. `"criterion 13: the worst result wins"`.

## Spec template (this repo)

Same as [`templates/spec.md`](templates/spec.md), which is also seula's default template.
