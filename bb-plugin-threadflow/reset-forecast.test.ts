import assert from "node:assert/strict";
import test from "node:test";
import { createResetForecastLoader } from "./reset-forecast.ts";

const forecast = {
  updated_at: "2026-09-08T01:00:00.000Z",
  probabilities: { rounded_24h: 25, rounded_48h: 45 },
  confidence: "low",
  official_signal: null,
};

test("forecast requests are shared and validated before caching", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ ...forecast, unused: "discarded" });
  });
  const load = createResetForecastLoader();
  const [first, second] = await Promise.all([load(), load()]);
  assert.deepEqual(first, { status: "ok", forecast });
  assert.deepEqual(second, first);
  assert.deepEqual(await load(), first);
  assert.equal(calls, 1);
});

test("forecast refresh expires and recovers after a failed request", async (t) => {
  let now = 0;
  let calls = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 2) throw new Error("network unavailable");
    return Response.json(forecast);
  });
  const load = createResetForecastLoader();
  assert.equal((await load()).status, "ok");
  now += 5 * 60_000;
  assert.deepEqual(await load(), { status: "unavailable" });
  assert.deepEqual(await load(), { status: "unavailable" });
  assert.equal(calls, 2);
  now += 60_000;
  assert.equal((await load()).status, "ok");
});

test("HTTP failures and malformed forecasts are unavailable", async (t) => {
  for (const response of [
    new Response("down", { status: 503 }),
    Response.json({ ...forecast, probabilities: { rounded_24h: 200, rounded_48h: 45 } }),
    Response.json({ ...forecast, updated_at: "yesterday" }),
  ]) {
    const mock = t.mock.method(globalThis, "fetch", async () => response);
    assert.deepEqual(await createResetForecastLoader()(), { status: "unavailable" });
    mock.mock.restore();
  }
});
