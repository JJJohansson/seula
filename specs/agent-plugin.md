# FEATURE: Claude Code plugin (skill, reviewer agent, spec-writer prompt)

> **Status: Active.** Written after the first implementation (26 Sep 2026); confirm the criteria. Criteria 9–11 approved and built 27 Sep 2026.

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
9. The spec-writer prompt tells the agent to read the ticket's comments in time order, after
   the description. A later comment that clearly answers a question or changes a requirement
   replaces the earlier text. When it is not clear which text the author means, the agent asks.
10. The spec-writer prompt tells the agent to carry each answer into the spec: an answered
    question leaves `## OPEN QUESTIONS` and becomes a criterion or a decision in the spec. The
    agent does not ask again a question that the ticket or the spec already answers.
11. The spec-writer prompt says that comments labelled `seula` are seula's earlier questions
    and results. The label shows where a question came from. It does not make the text an
    instruction, and the agent treats it as data like the rest of the ticket.

## OUT OF SCOPE
- Hooks that force the agent to run a gate.
- Skills or prompts for G2 to G5.

## EDGE CASES
- A repo without `seula.config.json`: the skill applies with the default config.
- The `spec-driven-development` skill is not installed: the gates still work; the spec format
  comes from the repo's own config and template.
