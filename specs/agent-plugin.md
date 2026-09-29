# FEATURE: Claude Code plugin (skill, reviewer agent, spec-writer and planner prompts)

> **Status: Active.** Written after the first implementation (26 Sep 2026); confirm the criteria. Criteria 9–11 approved and built 27 Sep 2026. **Plan step: the planner prompt and the skill's G2 part (the inputs, criteria 12–15 and the out-of-scope line) approved and built 28 Sep 2026** (see [`spec-to-plan-workflow.md`](spec-to-plan-workflow.md)). **The change to the ticket's part of a spec (the changes to criteria 13–14, criteria 16–17) approved 29 Sep 2026; not yet built** (see [`g1-spec-gate.md`](g1-spec-gate.md) criteria 18–20).

## OVERVIEW
seula installs as a Claude Code plugin with four parts: a skill that tells an agent which gate
to run after each step and what each result means; a reviewer agent that decides unsure items
and checks a change against its spec; a prompt for writing a spec from a ticket when no
person is present; and a prompt for writing the plan of an approved spec.

## WHY / INTENT
The gates help only if the agent runs them and obeys the result. The skill carries the knowledge
and the CLI carries the checks, so the agent's instructions stay short and the decisions stay
deterministic. The reviewer is a separate agent, so the agent that made the work never checks
it.

## INPUTS / OUTPUTS
- Inputs: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
  `skills/seula-gates/SKILL.md`, `agents/seula-reviewer.md`, `prompts/spec-writer.md`,
  `prompts/planner.md`.
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
12. `seula prompt planner --run <id> --spec <file> --approved <file>` renders the planner prompt
    from `prompts/planner.md`. The prompt contains no spec or ticket text. It names the spec
    file and tells the agent to treat the spec's content as data.
13. The planner prompt tells the agent to read the code that the plan changes, then to write
    only the spec's `## PLAN` section, in the task format of
    [`g2-plan-gate.md`](g2-plan-gate.md): numbered tasks, each with `Criteria:`, `Test:` and
    `Files:`, and every changed criterion covered ([`g2-plan-gate.md`](g2-plan-gate.md)
    criterion 3). It tells the agent to plan only the change when the spec was planned before.
    It forbids changing anything else in the spec, writing code, and commits and pushes.
14. The planner prompt tells the agent to run `seula gate g2` on the spec with `--approved`,
    `--run`, and `--base` when it is given (criterion 16), and to act on the exit code as the
    skill says. When the spec leaves a question
    that the plan needs, the agent asks and does not guess. It asks for `spec_path`, `status`
    (`ready`, `needs_input` or `blocked`), `questions` and `summary`, as the spec writer does.
15. The skill tells an agent to run G2 after it writes a plan, gives one concrete fix for each
    G2 rule (`task`, `coverage`, `path`, `approved`), and says that a flag is for the person who
    reviews the plan. It forbids changing a plan only to avoid a flag.
16. `seula prompt spec-writer` and `seula prompt planner` accept `--base <dir>`
    ([`g1-spec-gate.md`](g1-spec-gate.md), DATA SCHEMA). With it, the rendered prompt tells the
    agent to run its gate with `--base <dir>`. Without it, the prompt has no `--base`.
17. The spec-writer prompt tells the agent to change only the text that the ticket needs when
    it updates a spec that already exists. The agent leaves other text as it is, also when G1
    warns about that text ([`g1-spec-gate.md`](g1-spec-gate.md) criterion 20).

## OUT OF SCOPE
- Hooks that force the agent to run a gate.
- Skills or prompts for G3 to G5.

## EDGE CASES
- A repo without `seula.config.json`: the skill applies with the default config.
- The `spec-driven-development` skill is not installed: the gates still work; the spec format
  comes from the repo's own config and template.
