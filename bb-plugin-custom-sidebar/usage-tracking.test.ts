import assert from "node:assert/strict";
import test from "node:test";

import {
  appendUsageSample,
  calculateTodayUsedPercent,
  parseUsageSamples,
  type UsageSample,
} from "./usage-tracking.ts";

const DAY_START = Date.parse("2026-09-05T04:00:00.000Z");
const RESET_AT = "2026-09-11T18:00:00.000Z";

function sample(observedAt: number, usedPercent: number, resetsAt = RESET_AT): UsageSample {
  return { observedAt, resetsAt, usedPercent };
}

test("daily usage is the weekly increase after the local midnight sample", () => {
  assert.equal(calculateTodayUsedPercent({
    samples: [sample(DAY_START + 1_000, 39)],
    current: sample(DAY_START + 12 * 60 * 60 * 1_000, 45),
    dayStartedAt: DAY_START,
  }).usedPercent, 6);
});

test("the last pre-midnight sample is used when an exact midnight sample is unavailable", () => {
  assert.equal(calculateTodayUsedPercent({
    samples: [sample(DAY_START - 10 * 60 * 1_000, 40)],
    current: sample(DAY_START + 12 * 60 * 60 * 1_000, 45),
    dayStartedAt: DAY_START,
  }).usedPercent, 5);
});

test("the current value is all from today when the weekly window reset today", () => {
  const resetAt = new Date(DAY_START + 7 * 24 * 60 * 60 * 1_000 + 60 * 60 * 1_000).toISOString();
  assert.equal(calculateTodayUsedPercent({
    samples: [],
    current: sample(DAY_START + 2 * 60 * 60 * 1_000, 4, resetAt),
    dayStartedAt: DAY_START,
  }).usedPercent, 4);
});

test("tracking that began after midnight returns an honest lower bound", () => {
  assert.deepEqual(calculateTodayUsedPercent({
    samples: [],
    current: sample(DAY_START + 12 * 60 * 60 * 1_000, 45),
    dayStartedAt: DAY_START,
  }), { coverage: "partial-day", usedPercent: 0 });
  assert.deepEqual(calculateTodayUsedPercent({
    samples: [sample(DAY_START + 2 * 60 * 60 * 1_000, 40)],
    current: sample(DAY_START + 12 * 60 * 60 * 1_000, 45),
    dayStartedAt: DAY_START,
  }), { coverage: "partial-day", usedPercent: 5 });
});

test("stored samples are validated and bounded", () => {
  assert.deepEqual(parseUsageSamples("not json"), []);
  assert.deepEqual(parseUsageSamples(JSON.stringify([sample(DAY_START, 40), { observedAt: "bad" }])), [sample(DAY_START, 40)]);

  const current = sample(DAY_START + 9 * 24 * 60 * 60 * 1_000, 45);
  assert.deepEqual(appendUsageSample([sample(DAY_START, 30)], current), [current]);
});
