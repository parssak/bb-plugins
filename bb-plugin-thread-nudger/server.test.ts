import assert from "node:assert/strict";
import test from "node:test";

import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";

import plugin, { createThreadNudgeInput } from "./server.ts";

test("Thread Nudger messages stay out of user-visible chat history", () => {
  assert.deepEqual(createThreadNudgeInput("how's it going"), {
    type: "text",
    text: "how's it going",
    mentions: [],
    visibility: "agent-only",
  });
});

test("thread opt-outs persist across reloads and publish their new state", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "thread-nudger-test" });
  await plugin(bb);

  assert.deepEqual(
    await harness.behavior.callRpc("getThreadNudging", { threadId: "thread-1" }),
    { enabled: true },
  );
  assert.deepEqual(
    await harness.behavior.callRpc("setThreadNudging", {
      threadId: "thread-1",
      enabled: false,
    }),
    { enabled: false },
  );
  assert.deepEqual(harness.inspection.realtimeSignals, [{
    channel: "nudging-changed",
    payload: { threadId: "thread-1", enabled: false },
  }]);

  const reloaded = await harness.lifecycle.reload(plugin);
  assert.deepEqual(
    await reloaded.harness.behavior.callRpc("getThreadNudging", { threadId: "thread-1" }),
    { enabled: false },
  );
  await reloaded.harness.lifecycle.dispose();
});

test("disabled threads are skipped and re-enabling starts a fresh milestone clock", async () => {
  const oldActiveThread = makeThreadResponse({
    id: "thread-1",
    status: "active",
    updatedAt: Date.now() - 60 * 60_000,
  });
  const { bb, harness } = createFakePluginHost({
    pluginId: "thread-nudger-test",
    sdk: {
      threads: {
        list: async () => [oldActiveThread],
        send: async () => ({ ok: true, delivery: "joined" }),
      },
    },
  });
  await plugin(bb);
  await harness.behavior.callRpc("setThreadNudging", {
    threadId: oldActiveThread.id,
    enabled: false,
  });

  const disabledSweep = harness.behavior.runService("watch-active-threads");
  await new Promise((resolve) => setImmediate(resolve));
  disabledSweep.controller.abort();
  await disabledSweep.done;
  assert.equal(harness.inspection.sdk.callsTo("threads.send").length, 0);

  await harness.behavior.callRpc("setThreadNudging", {
    threadId: oldActiveThread.id,
    enabled: true,
  });
  const enabledSweep = harness.behavior.runService("watch-active-threads");
  await new Promise((resolve) => setImmediate(resolve));
  enabledSweep.controller.abort();
  await enabledSweep.done;
  assert.equal(harness.inspection.sdk.callsTo("threads.send").length, 0);

  await harness.lifecycle.dispose();
});
