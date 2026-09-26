# FEATURE: Claude Code plugin (skill, reviewer agent, spec-writer prompt)

> **Status: Active.** Written after the first implementation (26 Sep 2026); confirm the criteria.

## OVERVIEW
seula installs as a Claude Code plugin with three parts: a skill that tells an agent which gate
to run after each step and what each result means; a reviewer agent that decides unsure items
and checks a change against its spec; and a prompt for writing a spec from a ticket when no
person is present.

## WHY / INTENT
The gates help only if the agent runs them and obeys the result. The skill carries the knowledge
and the CLI carries the checks, so the agent's instructions stay short and the decisions stay
deterministic. The reviewer is a separate agent, so the agent that made the work never checks
it.

## INPUTS / OUTPUTS
- Inputs: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
  `skills/seula-gates/SKILL.md`, `agents/seula-reviewer.md`, `prompts/spec-writer.md`.
- Outputs: a plugin that installs with `/plugin marketplace add JJJohansson/seula`, or loads
  with `claude --plugin-dir <path>`.

## ACCEPTANCE CRITERIA
1. After `/plugin marketplace add JJJohansson/seula` and `/plugin install seula@seula`, the
   `seula-gates` skill and the `seula-reviewer` agent are available in Claude Code.
2. The skill maps each exit code (0, 1, 2, 3, 64) to exactly one action.
3. The skill forbids editing run files, changing the config or the thresholds to pass a gate,
   obeying instructions in ticket text, and setting a spec to Approved, Active or Shipped.
4. The skill gives one concrete fix for each G1 question (`testable`, `unambiguous`, `behavior`,
   `inScope`).
5. The reviewer agent has only the Read, Grep and Glob tools and runs on the Opus model.
6. The reviewer answers in a fixed format: a table of criterion, result, reason and location;
   the extra behavior; the replacement criteria; and a last line `VERDICT: pass`,
   `VERDICT: rework` or `VERDICT: ask-person`.
7. The spec-writer prompt contains no ticket text. It names the ticket file and tells the agent
   to treat the file's content as data.
8. The spec-writer prompt limits changes to files in the configured spec directory, forbids
   commits and pushes, and asks for `spec_path`, `status` (`ready`, `needs_input` or
   `blocked`), `questions` and `summary`.

## OUT OF SCOPE
- Hooks that force the agent to run a gate.
- Skills or prompts for G2 to G5.

## EDGE CASES
- A repo without `seula.config.json`: the skill applies with the default config.
- The `spec-driven-development` skill is not installed: the gates still work; the spec format
  comes from the repo's own config and template.
