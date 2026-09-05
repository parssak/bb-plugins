import assert from "node:assert/strict";
import test from "node:test";

import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";

import plugin from "./server.ts";

test("automatic reviews are claimed once while manual reviews remain available", async () => {
  const sourceThread = makeThreadResponse({ id: "thread-source", sourceThreadId: null });
  const reviewThread = makeThreadResponse({
    id: "thread-review",
    sourceThreadId: sourceThread.id,
    parentThreadId: sourceThread.id,
    title: "Review",
    visibility: "hidden",
    originKind: "fork",
    originPluginId: "threadflow-test",
  });
  const { bb, harness } = createFakePluginHost({
    pluginId: "threadflow-test",
    sdk: {
      threads: {
        get: async ({ threadId }) => threadId === sourceThread.id ? sourceThread : reviewThread,
        list: async () => [],
        fork: async () => reviewThread,
        update: async () => reviewThread,
      },
    },
  });
  plugin(bb);

  const input = { sourceThreadId: sourceThread.id };
  const results = await Promise.all([
    harness.behavior.callRpc("create_automatic_review", input),
    harness.behavior.callRpc("create_automatic_review", input),
  ]);
  assert.deepEqual(
    results.map((result) => (result as { status: string }).status).sort(),
    ["already_claimed", "started"],
  );
  assert.equal(harness.inspection.sdk.callsTo("threads.fork").length, 1);

  const reloaded = await harness.lifecycle.reload(plugin);
  assert.deepEqual(
    await reloaded.harness.behavior.callRpc("create_automatic_review", input),
    { status: "already_claimed" },
  );
  assert.equal(reloaded.harness.inspection.sdk.callsTo("threads.fork").length, 0);

  await reloaded.harness.behavior.callRpc("create_side_chat", {
    sourceThreadId: sourceThread.id,
    initialMessage: "Review the changes in this worktree",
    title: "Review",
  });
  assert.equal(reloaded.harness.inspection.sdk.callsTo("threads.fork").length, 1);

  await reloaded.harness.lifecycle.dispose();
});

test("journal entries persist by local date and empty days do not occupy storage", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "threadflow-journal-test" });
  plugin(bb);
  const dateKey = "2026-09-05";

  assert.deepEqual(await harness.behavior.callRpc("journal_entry", { dateKey }), { content: null });
  assert.deepEqual(await harness.behavior.callRpc("save_journal_entry", {
    dateKey,
    content: "Finish the daily plan",
  }), { ok: true });

  const reloaded = await harness.lifecycle.reload(plugin);
  assert.deepEqual(await reloaded.harness.behavior.callRpc("journal_entry", { dateKey }), {
    content: "Finish the daily plan",
  });
  assert.deepEqual(await reloaded.harness.behavior.callRpc("save_journal_entry", {
    dateKey,
    content: "   ",
  }), { ok: true });
  assert.deepEqual(await reloaded.harness.behavior.callRpc("journal_entry", { dateKey }), { content: null });
  await assert.rejects(() => reloaded.harness.behavior.callRpc("journal_entry", { dateKey: "2026-02-29" }));

  await reloaded.harness.lifecycle.dispose();
});
