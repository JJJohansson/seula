# FEATURE: Workflow dashboard

> **Status:** Idea

## OVERVIEW
A local web page, started with `seula dashboard`, that shows every feature in flight: its
current step, each gate's history, Jev's scores, cost so far, and what waits on a person.

## WHY / INTENT
`seula status` answers "where is everything" in a terminal. A page makes the gate evidence
browsable during a review or a demo, and puts the features that need a person first.

## INPUTS / OUTPUTS
- Inputs: the run files of open seula pull requests, read through the GitHub API with the local
  GitHub login.
- Outputs: a page on `http://localhost:<port>`.

## ACCEPTANCE CRITERIA
1. `seula dashboard` serves a page on localhost that lists one row per open pull request whose
   branch has a run file.
2. Each row shows the ticket id, title, current step, gate history symbols, next action, and
   total cost (Claude plus Jev).
3. Rows that wait on a person are listed first, under a count of them.
4. Selecting a row shows every event of that run: gate, attempt, result, feedback lines, and
   Jev cost.
5. The GitHub token stays in the local server process and is never sent to the browser.

## OUT OF SCOPE
- Editing runs or approving specs from the page.
- Hosting the page anywhere other than localhost.

## EDGE CASES
- No GitHub login: the page shows the local run files only, with a note.
- A pull request without a run file is not listed.
