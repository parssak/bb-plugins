import assert from "node:assert/strict";
import test from "node:test";
import { createResetForecastLoader, formatResetForecast } from "./reset-forecast.ts";

const forecast = {
  updated_at: "2026-09-08T01:00:00.000Z",
  probabilities: { rounded_24h: 25 },
  official_signal: null,
};

test("concurrent requests are shared, but each subsequent refresh fetches fresh data", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.cache, "no-store");
    calls++;
    return Response.json({ ...forecast, unused: "discarded" });
  });
  const load = createResetForecastLoader();
  const [first, second] = await Promise.all([load(), load()]);
  assert.deepEqual(first, { status: "ok", forecast });
  assert.deepEqual(second, first);
  assert.deepEqual(await load(), first);
  assert.equal(calls, 2);
});

test("the next manual refresh can recover immediately after a failed request", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 2) throw new Error("network unavailable");
    return Response.json(forecast);
  });
  const load = createResetForecastLoader();
  assert.equal((await load()).status, "ok");
  assert.deepEqual(await load(), { status: "unavailable" });
  assert.equal(calls, 2);
  assert.equal((await load()).status, "ok");
});

test("announced reset times use local time instead of the source's Pacific label", () => {
  const announced = {
    ...forecast,
    mode: "announced",
    official_signal: { window: {
      label: "around 6 PM PT on Sep 7",
      end_at: "2026-09-08T02:00:00.000Z",
      target_at: "2026-09-08T01:00:00.000Z",
      target_kind: "center",
    } },
  };
  const now = new Date("2026-09-08T00:00:00.000Z");
  assert.equal(formatResetForecast(announced, now, "America/Toronto"), "Codex reset: expected ~9 PM EDT");
  assert.equal(formatResetForecast(announced, now, "Asia/Kolkata"), "Codex reset: expected ~6:30 AM GMT+5:30");
  assert.equal(formatResetForecast(announced, new Date("2026-09-07T01:00:00.000Z"), "America/Toronto"), "Codex reset: expected ~Sep 7, 9 PM EDT");
  assert.equal(formatResetForecast(announced, new Date("2026-09-08T02:00:00.000Z"), "America/Toronto"), "Codex reset: 25% chance in next 24h");
  assert.equal(formatResetForecast({ ...announced, mode: "forecast" }, now, "America/Toronto"), "Codex reset: 25% chance in next 24h");
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
