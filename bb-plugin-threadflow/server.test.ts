import assert from "node:assert/strict";
import test from "node:test";

import { createFakePluginHost, makeQueueEntry, makeThreadResponse } from "@get-bb/plugin-sdk/testing";

import plugin from "./server.ts";

test("thread list RPC preserves BB's aggregate queued-work state", async () => {
  const sendAt = Date.now() + 3 * 60 * 60 * 1_000;
  const scheduledThread = {
    ...makeThreadResponse({
      createdAt: Date.now(),
      id: "thread-scheduled",
      queuedWork: "waiting",
      status: "idle",
      title: "Send this later",
      updatedAt: Date.now(),
    }),
    hasPendingInteraction: false,
  };
  const { bb, harness } = createFakePluginHost({
    pluginId: "threadflow-queue-test",
    sdk: {
      threads: {
        list: async ({ archived, includeHidden }) => (
          archived === false && includeHidden === false ? [scheduledThread] : []
        ),
        queue: {
          list: async () => [makeQueueEntry({
            threadId: scheduledThread.id,
            waitingOn: { kind: "time" },
            sendAt,
          })],
        },
      },
      projects: { list: async () => [] },
      providers: { list: async () => [] },
    },
  });
  plugin(bb);

  const result = await harness.behavior.callRpc("threads", { scope: "recent", query: "" });
  assert.equal(result.threads[0]?.queuedWork, "waiting");
  assert.equal(result.threads[0]?.scheduledSendAt, sendAt);
  await harness.lifecycle.dispose();
});

test("waiting status exposes a scheduled queued continuation", async () => {
  const sendAt = Date.now() + 4 * 60 * 60 * 1_000;
  const thread = makeThreadResponse({ id: "thread-scheduled" });
  const entry = makeQueueEntry({
    id: "queue-scheduled",
    threadId: thread.id,
    sendAt,
    waitingOn: { kind: "time" },
    content: [
      { type: "text", text: "Merge, wait for deployment, then test production.", mentions: [] },
      { type: "text", text: "hidden marker", mentions: [], visibility: "agent-only" },
    ],
  });
  const { bb, harness } = createFakePluginHost({
    pluginId: "threadflow-queue-status-test",
    sdk: {
      threads: {
        get: async () => thread,
        queuedMessages: { list: async () => [entry] },
      },
    },
  });
  plugin(bb);

  assert.deepEqual(await harness.behavior.callRpc("active_threadflow_wait", { threadId: thread.id }), {
    wait: null,
    queuedWait: {
      id: entry.id,
      waitingKind: "time",
      reason: "This continuation will be sent automatically at the scheduled time.",
      message: "Merge, wait for deployment, then test production.",
      sendAt,
    },
  });

  await harness.lifecycle.dispose();
});

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

test("journal thread statuses distinguish archived and in-progress links", async () => {
  const archived = makeThreadResponse({ id: "thread-archived", archivedAt: Date.now() });
  const working = makeThreadResponse({ id: "thread-working", status: "active" });
  const waiting = makeThreadResponse({ id: "thread-waiting", queuedWork: "waiting" });
  const needsAttention = makeThreadResponse({
    id: "thread-needs-attention",
    hasPendingInteraction: true,
    queuedWork: "waiting",
  });
  const sourceWithWorkingSideChat = makeThreadResponse({ id: "thread-with-side-chat" });
  const workingSideChat = makeThreadResponse({
    id: "thread-side-chat",
    sourceThreadId: sourceWithWorkingSideChat.id,
    originKind: "fork",
    status: "active",
    visibility: "hidden",
  });
  const threads = new Map([
    archived,
    working,
    waiting,
    needsAttention,
    sourceWithWorkingSideChat,
  ].map((thread) => [thread.id, thread]));
  const { bb, harness } = createFakePluginHost({
    pluginId: "threadflow-journal-status-test",
    sdk: {
      threads: {
        get: async ({ threadId }) => {
          const thread = threads.get(threadId);
          if (thread === undefined) throw new Error("Thread not found");
          return thread;
        },
        list: async () => [workingSideChat],
      },
    },
  });
  plugin(bb);

  assert.deepEqual(await harness.behavior.callRpc("journal_thread_statuses", {
    threadIds: [
      archived.id,
      working.id,
      waiting.id,
      needsAttention.id,
      sourceWithWorkingSideChat.id,
      "thread-missing",
      archived.id,
    ],
  }), {
    statuses: [
      { threadId: archived.id, status: "archived" },
      { threadId: working.id, status: "in-progress" },
      { threadId: waiting.id, status: "in-progress" },
      { threadId: sourceWithWorkingSideChat.id, status: "in-progress" },
    ],
  });

  await harness.lifecycle.dispose();
});

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
    legacySamples: [{ observedAt: dayStartedAt + 2 * 60 * 60 * 1_000, resetsAt, usedPercent: 45 }],
  });
  assert.deepEqual(first.status === "ok" ? first.todayUsage : null, {
    coverage: "partial-day",
    usedPercent: 5,
  });

  usedPercent = 54;
  const reloaded = await harness.lifecycle.reload(plugin);
  const second = await reloaded.harness.behavior.callRpc("codex_usage", {
    dayStartedAt,
    legacySamples: [{ observedAt: dayStartedAt + 60 * 60 * 1_000, resetsAt, usedPercent: 40 }],
  });
  assert.deepEqual(second.status === "ok" ? second.todayUsage : null, {
    coverage: "partial-day",
    usedPercent: 14,
  });

  usedPercent = 55;
  const third = await reloaded.harness.behavior.callRpc("codex_usage", { dayStartedAt });
  assert.deepEqual(third.status === "ok" ? third.todayUsage : null, {
    coverage: "partial-day",
    usedPercent: 15,
  });
  await reloaded.harness.lifecycle.dispose();
});

test("workout scratchpad migrates once and persists in shared plugin storage", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "threadflow-scratchpad-storage-test" });
  plugin(bb);

  assert.deepEqual(await harness.behavior.callRpc("workout_scratchpad", {
    legacyContent: "Pushups: 30",
  }), { content: "Pushups: 30" });

  const reloaded = await harness.lifecycle.reload(plugin);
  assert.deepEqual(await reloaded.harness.behavior.callRpc("workout_scratchpad", {
    legacyContent: "Pushups: stale device value",
  }), { content: "Pushups: 30" });
  assert.deepEqual(await reloaded.harness.behavior.callRpc("save_workout_scratchpad", {
    content: "Pullups: 8",
  }), { ok: true });
  assert.deepEqual(await reloaded.harness.behavior.callRpc("workout_scratchpad", {}), {
    content: "Pullups: 8",
  });

  await reloaded.harness.lifecycle.dispose();
});
