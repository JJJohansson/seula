# FEATURE: G0 ticket gate

> **Status: Active.** Written after the first implementation (26 Sep 2026); confirm the criteria.

## OVERVIEW
A command that checks whether a ticket holds enough information to write a spec from, before
any agent starts writing. When it doesn't, the command returns questions to post back on the
ticket.

## WHY / INTENT
An agent given a vague ticket guesses. A specific question to the ticket author costs less than
reviewing a spec built on a guess.

## INPUTS / OUTPUTS
- Inputs: a ticket text file; an optional `--title`; `seula.config.json`; `TYPESAFE_API_KEY` or a
  recording file.
- Outputs: a report with the decision, the questions for the ticket ("asks") and notes; an exit
  code; a G0 event in the run file when `--run` is given.

## ACCEPTANCE CRITERIA
1. `seula gate g0 --ticket <file>` returns back without calling Jev when the ticket has fewer
   than `minTicketWords` words (default 8). The ask is "The ticket is too short to write a spec
   from. Describe the goal in a few sentences."
2. Otherwise it sends one Jev request that contains the ticket text and the configured ticket
   questions (default: `goal`, `contradiction`, `agentInstructions`, `sensitive`, `audience`).
3. Each ticket question has an `onFail` of `back`, `review` or `flag`, and a message.
4. A `back` question whose answer routes to back adds its message to the asks and makes the
   result back (exit 1).
5. A `review` question that does not pass, or a `back` question whose answer is unsure, adds a
   note and makes the result unsure (exit 2) unless the result is already back.
6. A `flag` question that does not pass adds its message to the notes and does not change the
   result.
7. An `agentInstructions` answer that does not pass never gives a pass result.
8. The `--json` output contains `decision`, `asks` and `notes`, so a workflow can post them on
   the ticket.
9. With `--run`, the result is recorded as a G0 event. After a G0 back, the run waits on a
   person, because the ticket author answers the questions.
10. Without `TYPESAFE_API_KEY` and without `--recorded`, the word-count check of criterion 1
    still runs; when the ticket is long enough, the Jev check is reported as skipped and the
    command exits 0.

## OUT OF SCOPE
- Posting to the issue tracker; the workflow does that.
- Rewriting the ticket.

## EDGE CASES
- Tokens made only of punctuation don't count as words.
- An empty ticket file returns back as too short.
