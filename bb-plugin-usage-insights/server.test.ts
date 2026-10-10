import assert from "node:assert/strict";
import test from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.ts";

test("usage samples migrate to shared plugin storage and survive reloads", async () => {
  const now = Date.now();
  const dayStartedAt = new Date(now).setHours(0, 0, 0, 0);
  const resetsAt = new Date(now + 6 * 24 * 60 * 60 * 1_000).toISOString();
  let usedPercent = 50;
  const { bb, harness } = createFakePluginHost({
    pluginId: "threadflow-usage-storage-test",
    sdk: {
      system: {
        usageLimits: async () => ({
          codex: {
            status: "ok",
            accountEmail: "person@example.com",
            planLabel: "Pro",
            windows: [{ label: "Weekly limit", resetsAt, usedPercent }],
          },
        }),
      },
    },
  });
  plugin(bb);

  const first = await harness.behavior.callRpc("codex_usage", {
    dayStartedAt,
    legacySamples: [
      {
        observedAt: dayStartedAt + 2 * 60 * 60 * 1_000,
        resetsAt,
        usedPercent: 45,
      },
    ],
  });
  assert.deepEqual(first.status === "ok" ? first.todayUsage : null, {
    coverage: "partial-day",
    usedPercent: 5,
  });

  usedPercent = 54;
  const reloaded = await harness.lifecycle.reload(plugin);
  const second = await reloaded.harness.behavior.callRpc("codex_usage", {
    dayStartedAt,
    legacySamples: [
      { observedAt: dayStartedAt + 60 * 60 * 1_000, resetsAt, usedPercent: 40 },
    ],
  });
  assert.deepEqual(second.status === "ok" ? second.todayUsage : null, {
    coverage: "partial-day",
    usedPercent: 14,
  });

  usedPercent = 55;
  const third = await reloaded.harness.behavior.callRpc("codex_usage", {
    dayStartedAt,
  });
  assert.deepEqual(third.status === "ok" ? third.todayUsage : null, {
    coverage: "partial-day",
    usedPercent: 15,
  });
  await reloaded.harness.lifecycle.dispose();
});
