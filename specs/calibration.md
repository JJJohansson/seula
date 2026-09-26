# FEATURE: Cut-off calibration

> **Status: Active.** Written after the first implementation (26 Sep 2026); confirm the criteria.

## OVERVIEW
`seula calibrate` runs Jev on labeled example criteria and recommends pass and back cut-offs
for each question, so the thresholds come from evidence instead of guesses.

## WHY / INTENT
Jev's probabilities are calibrated, but the right cut-off depends on what each mistake costs in
this repo. Sending good criteria back wastes agent loops and people's patience; letting bad ones
through costs rework later.

## INPUTS / OUTPUTS
- Inputs: a labels file (examples with context, a criterion, and the expected good or bad
  answer per question); `TYPESAFE_API_KEY` or a recording file.
- Outputs: a report per question, and a config snippet with `questionThresholds`.

## ACCEPTANCE CRITERIA
1. Each labeled example produces one Jev request with the same questions and the same context
   format as G1.
2. For each example, only the questions listed in its `expect` are scored.
3. For each question, the report shows the number of good and bad examples and, for the current
   and the recommended cut-offs, the false blocks (good examples sent back), the misses (bad
   examples passed) and the share of unsure results.
4. The recommended cut-offs are the pair from a grid of 0.05 to 0.95 in steps of 0.05, with
   `blockBelow` not above `passAt`, that has the fewest false blocks, then the fewest misses,
   then the fewest unsure results, then the smallest distance from the current cut-offs.
5. A question with fewer than 10 good or fewer than 10 bad examples is marked as a small sample.
6. The report ends with a JSON snippet that can be pasted into `seula.config.json`.
7. Without `TYPESAFE_API_KEY` and without `--recorded`, the command exits 64 with a message.

## OUT OF SCOPE
- Writing the config file automatically.
- Comparing Jev with another model on the same labels (planned; needs a second
  `DecisionModel`).

## EDGE CASES
- An `expect` entry for a question that the config doesn't have is ignored.
