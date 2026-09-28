# FEATURE: Page description

> **Status:** Approved (28 Sep 2026, merged in #142)

## OVERVIEW
The page has a short description for search results and shared links.

## ACCEPTANCE CRITERIA
1. The page has a description of one sentence, at most 160 characters.
2. Search results and link previews can show the description.
3. The description says what the app does.

## OUT OF SCOPE
- Preview images.

## EDGE CASES
- A browser that ignores the description: nothing breaks.

## PLAN
The description goes in the page's head.

1. Add the description meta tag. Criteria: 1, 2. Test: client/index.test.ts "criterion 1: the
   page has a description". Files: client/index.html.
2. Write the sentence. Criteria: 3. Test: client/index.test.ts "criterion 3: it says what the
   app does". Files: client/index.html, client/src/strings.ts.
