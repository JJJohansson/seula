# FEATURE: Export shopping list as CSV

> **Status:** Approved

## OVERVIEW
Let the user download the current week's shopping list as a CSV file, so they can open it
in a spreadsheet or share it.

## WHY / INTENT
Users plan in the app but shop with other tools. A plain file is the simplest bridge.

## INPUTS / OUTPUTS
- Inputs: the active week's shopping list.
- Outputs: a `shopping-list-YYYY-MM-DD.csv` download.

## ACCEPTANCE CRITERIA
1. The shopping list view has an "Export CSV" button.
2. Clicking it downloads a file named `shopping-list-<monday's date>.csv`, where the date is
   the Monday of the active week in `YYYY-MM-DD` form.
3. The file has a header row `item,checked` and one row per list line, in list order.
4. Lines containing commas or quotes are escaped per RFC 4180.
5. An empty list downloads a file with only the header row.

## OUT OF SCOPE
- Other formats (PDF, Excel).
- Exporting more than one week at a time.

## EDGE CASES
- Very long lists (500+ lines) still export in under a second.
- Non-ASCII item names are written as UTF-8.

---
Do not begin implementation until the acceptance criteria are confirmed.
