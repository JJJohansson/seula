import assert from "node:assert/strict";
import { test } from "node:test";
import { approveSpec } from "../src/approve.ts";
import { UsageError } from "../src/errors.ts";
import { config, fixture } from "./helpers.ts";

// spec-to-plan-workflow criterion 15: `seula approve` marks a merged spec Approved, and nothing else.
// The status blocks over several lines, and buildable statuses, are in g2Base.test.ts.
const SPEC = fixture("plan-spec.md").replace(/\r\n/g, "\n").replace(/^> \*\*Status:\*\*.*$/m, "> **Status:** Idea");
const TODAY = new Date(Date.UTC(2026, 8, 28));
const APPROVED = "> **Status:** Approved (28 Sep 2026, merged in #142).";

test("spec-to-plan criterion 15: the status line becomes Approved with the date and the PR, and nothing else changes", () => {
  const out = approveSpec(SPEC, config(), 142, TODAY);
  const [before, after] = [SPEC.split("\n"), out.split("\n")];
  assert.equal(after.length, before.length);
  const changed = after.flatMap((line, i) => (line === before[i] ? [] : [[before[i], line]]));
  assert.deepEqual(changed, [["> **Status:** Idea", APPROVED]]);
});

test("spec-to-plan criterion 15: CRLF line endings stay CRLF", () => {
  const out = approveSpec(SPEC.replace(/\n/g, "\r\n"), config(), 142, TODAY);
  assert.ok(out.includes(`${APPROVED}\r\n`));
  assert.equal(out.replace(APPROVED, "> **Status:** Idea"), SPEC.replace(/\n/g, "\r\n"));
});

test("spec-to-plan criterion 15: only the status marker of a long status line is replaced; its other text stays", () => {
  const long = SPEC.replace("> **Status:** Idea", "> **Status:** Idea. Drafted 28 Sep 2026 from ticket X. **Note:** more text.");
  const out = approveSpec(long, config(), 7, TODAY);
  assert.match(out, /^> \*\*Status:\*\* Approved \(28 Sep 2026, merged in #7\)\. Drafted 28 Sep 2026 from ticket X\. \*\*Note:\*\* more text\.$/m);
});

test("spec-to-plan criterion 15: no status line, a bad PR number, or no Approved status is a usage error", () => {
  const noStatus = SPEC.replace(/^> \*\*Status:\*\*.*\n/m, "");
  assert.throws(() => approveSpec(noStatus, config(), 142, TODAY), (e) => e instanceof UsageError && /status line/.test(e.message));
  for (const pr of [0, -3, 1.5, Number.NaN]) {
    assert.throws(() => approveSpec(SPEC, config(), pr, TODAY), UsageError, String(pr));
  }
  const cfg = config();
  cfg.statuses = ["Idea", "Accepted"];
  assert.throws(() => approveSpec(SPEC, cfg, 142, TODAY), (e) => e instanceof UsageError && /Approved/.test(e.message));
});
