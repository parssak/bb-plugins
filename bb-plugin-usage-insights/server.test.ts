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

test("Claude Code reports session and weekly limits with its own daily history", async () => {
  const now = Date.now();
  const dayStartedAt = new Date(now).setHours(0, 0, 0, 0);
  const resetsAt = new Date(now + 6 * 86400000).toISOString();
  let weeklyUsed = 20;
  const { bb, harness } = createFakePluginHost({
    sdk: {
      system: {
        usageLimits: async ({ providerId }) => ({
          [providerId!]: {
            status: "ok",
            planLabel: "Max",
            accountEmail: null,
            windows: [
              { label: "Current session", resetsAt, usedPercent: 45 },
              {
                label: "Weekly limit",
                resetsAt,
                usedPercent: providerId === "codex" ? 80 : weeklyUsed,
              },
              { label: "Sonnet", resetsAt, usedPercent: 15 },
            ],
          },
        }),
      },
    },
  });
  plugin(bb);
  await harness.behavior.callRpc("provider_usage", {
    providerId: "codex",
    dayStartedAt,
  });
  await harness.behavior.callRpc("provider_usage", {
    providerId: "claude-code",
    dayStartedAt,
  });
  weeklyUsed = 25;
  const reloaded = await harness.lifecycle.reload(plugin);
  const result = await reloaded.harness.behavior.callRpc("provider_usage", {
    providerId: "claude-code",
    dayStartedAt,
  });
  assert.equal(result.status, "ok");
  assert.equal(result.windows.length, 3);
  assert.equal(result.planLabel, "Max");
  assert.equal(result.todayUsage.usedPercent, 5);
  assert.equal(
    (
      await reloaded.bb.storage.kv.get<Array<{ usedPercent: number }>>(
        "usage:samples:v1",
      )
    )?.at(-1)?.usedPercent,
    80,
  );
  assert.equal(
    (
      await reloaded.bb.storage.kv.get<Array<{ usedPercent: number }>>(
        "usage:claude-code:samples:v1",
      )
    )?.at(-1)?.usedPercent,
    25,
  );
  await reloaded.harness.lifecycle.dispose();
});

test("a session-only limit never becomes a weekly daily estimate", async () => {
  const { bb, harness } = createFakePluginHost({
    sdk: {
      system: {
        usageLimits: async () => ({
          "claude-code": {
            status: "ok",
            accountEmail: null,
            planLabel: null,
            windows: [
              { label: "Current session", resetsAt: null, usedPercent: 30 },
            ],
          },
        }),
      },
    },
  });
  plugin(bb);
  const result = await harness.behavior.callRpc("provider_usage", {
    providerId: "claude-code",
    dayStartedAt: 0,
  });
  assert.equal(result.status, "ok");
  assert.equal(result.todayUsage, null);
  assert.equal(
    await bb.storage.kv.get("usage:claude-code:samples:v1"),
    undefined,
  );
  await harness.lifecycle.dispose();
});

test("Claude authentication failure leaves Codex usage available", async () => {
  const { bb, harness } = createFakePluginHost({
    sdk: {
      system: {
        usageLimits: async ({ providerId }) => ({
          [providerId!]:
            providerId === "claude-code"
              ? { status: "expired" }
              : {
                  status: "ok",
                  accountEmail: null,
                  planLabel: null,
                  windows: [],
                },
        }),
      },
    },
  });
  plugin(bb);
  const claude = await harness.behavior.callRpc("provider_usage", {
    providerId: "claude-code",
    dayStartedAt: 0,
  });
  assert.deepEqual(claude, {
    status: "unavailable",
    message: "Sign in to Claude Code to see usage",
  });
  assert.equal(
    (
      await harness.behavior.callRpc("provider_usage", {
        providerId: "codex",
        dayStartedAt: 0,
      })
    ).status,
    "ok",
  );
  await harness.lifecycle.dispose();
});
