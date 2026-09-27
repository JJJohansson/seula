# FEATURE: Round extras: skip unchanged tickets, round warning, earlier rounds

> **Status:** Idea (27 Sep 2026). Split from change B of
> [`ticket-to-spec-workflow.md`](ticket-to-spec-workflow.md) (its criteria 23–24 and part of 25).
> Decide after change B1 is built and real runs show how often a ticket runs again with nothing
> new.

## OVERVIEW
Three conveniences on top of the rounds of the ticket-to-spec workflow
([`ticket-to-spec-workflow.md`](ticket-to-spec-workflow.md) criteria 20–22): skip a round when
the ticket has nothing new, warn when a ticket has had many rounds, and show earlier rounds in
the pull request.

## WHY / INTENT
A ticket that moves to Ready for spec again without changes costs a Claude run and posts the
same questions again. Many rounds on one ticket are a sign that it needs a conversation more than
another round. A reviewer can want to see what earlier rounds found. Change B1 already keeps every
decision correct; these criteria only save cost and help people follow a ticket's history.

## INPUTS / OUTPUTS
- Inputs: the continued run file and the ticket file on the open pull request's branch;
  `roundWarning` in `seula.config.json`.
- Outputs: a "nothing new" comment and a ticket move; one more line in the report comment; an
  "Earlier rounds" section in the pull request.

## ACCEPTANCE CRITERIA
1. The workflow doesn't start a new round when nothing is new. Nothing is new when all of
   these are true: the ticket has an open pull request with a valid run file (ticket-to-spec
   criteria 20–21); the last committed round in that file has a G1 result of pass, back or
   unsure, or of skipped when no Jev key is configured (as in ticket-to-spec criterion 8); and
   the ticket's title, its description and its comments that are not labelled `seula`
   ([`trackers.md`](trackers.md) criterion 11) are the same as in the ticket file on that
   branch. Then the workflow runs neither G0 nor Claude and commits nothing. It posts one
   comment: nothing changed on the ticket since round N, the link to the pull request, and that
   the ticket's author can add a comment with what changed, then start seula again. It sets the
   ticket to `specReview` when the pull request is ready for review, and to `needsInput` when it
   is a draft.
2. `roundWarning` in `seula.config.json` is a whole number, default 3; 0 turns the warning off.
   From round `roundWarning` on, the report comment (ticket-to-spec criterion 9) has one more
   line: the round number, and that each round runs Claude again. The warning never stops a run
   and never changes the ticket's state.
3. The pull request lists the earlier rounds' gate results under "Earlier rounds (from the run
   file on `<branch>`)", with the name of the branch that the run file came from. Its cost line
   gives the current round's Claude cost next to the total.

## OUT OF SCOPE
- A hard stop after a number of rounds. The round warning only informs.

## EDGE CASES
- G0 sends back on a ticket with an open pull request: the round commits nothing. The ticket
  text that caused the back still differs from the last committed round, so criterion 1 never
  skips the next round.
- The last round's G1 couldn't run (no G1 result, or skipped with a Jev key configured): a
  retry is never "nothing new", so the round runs.
- A person's comment that starts with `seula · ` is labelled `seula` and doesn't count as new.
  The "nothing new" comment tells the author to add a comment, so a second comment starts the
  round.
- The "nothing new" comment starts with `seula · ` (ticket-to-spec criterion 19), so the next
  run doesn't count it as new.
- The ticket file on the branch was written before comments were read, so it has no
  `## Comments` section: it counts as a ticket with no comments.
- Earlier rounds come from a branch that anyone with push access can change. They are shown,
  labelled with their branch, and never decide anything (ticket-to-spec criterion 22).
