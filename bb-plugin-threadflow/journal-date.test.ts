import assert from "node:assert/strict";
import test from "node:test";

import {
  formatJournalDate,
  isJournalDateKey,
  localJournalDateKey,
  shiftJournalDateKey,
} from "./journal-date.ts";

test("uses the viewer's local calendar day as the journal key", () => {
  assert.equal(localJournalDateKey(new Date(2026, 8, 5, 23, 59)), "2026-09-05");
});

test("rejects impossible calendar dates", () => {
  assert.equal(isJournalDateKey("2026-02-29"), false);
  assert.equal(isJournalDateKey("2024-02-29"), true);
  assert.equal(isJournalDateKey("2026-9-05"), false);
});

test("formats the daily heading", () => {
  assert.equal(formatJournalDate("2026-09-05", "en-US"), "Saturday, September 5, 2026");
});

test("moves between local calendar days", () => {
  assert.equal(shiftJournalDateKey("2026-09-05", -1), "2026-09-04");
  assert.equal(shiftJournalDateKey("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftJournalDateKey("2024-02-28", 1), "2024-02-29");
});
