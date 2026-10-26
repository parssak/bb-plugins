import assert from "node:assert/strict";
import test from "node:test";
import {
  createFakePluginHost,
  makeQueueEntry,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.ts";

test("wait metadata reports scheduled sends without fetching thread snapshots", async () => {
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
        list: async ({ archived, includeHidden }) =>
          archived === false && includeHidden === true ? [scheduledThread] : [],
        queue: {
          list: async () => [
            makeQueueEntry({
              threadId: scheduledThread.id,
              waitingOn: { kind: "time" },
              sendAt,
            }),
          ],
        },
      },
      projects: { list: async () => [] },
      providers: { list: async () => [] },
    },
  });
  plugin(bb);

  const result = await harness.behavior.callRpc("wait_dependencies", {});
  assert.deepEqual(result.scheduledSends, [
    { threadId: scheduledThread.id, sendAt },
  ]);
  assert.deepEqual(result.dependencies, []);
  assert.equal(harness.inspection.sdk.callsTo("threads.list").length, 0);
  await harness.lifecycle.dispose();
});

test("hidden review threads and their side chats report their owning thread", async () => {
  const listEntry = (
    overrides: Parameters<typeof makeThreadResponse>[0],
    activeBackgroundAgentCount = 0,
  ) => ({
    ...makeThreadResponse({ queuedWork: "none", ...overrides }),
    hasPendingInteraction: false,
    activity: {
      activeBackgroundAgentCount,
      activeBackgroundCommandCount: 0,
      activeGoalCount: 0,
      activePlanModeCount: 0,
      activeWorkflowCount: 0,
    },
  });
  const review = listEntry(
    {
      id: "review",
      title: "Review",
      parentThreadId: "parent",
      sourceThreadId: "parent",
      originKind: "fork",
      originPluginId: "chat-tools",
      visibility: "hidden",
      status: "idle",
      queuedWork: "waiting",
      createdAt: 2,
    },
    2,
  );
  const reply = listEntry({
    id: "reply",
    titleFallback: "Replying to this earlier message",
    lifecycleOwnerThreadId: "review",
    sourceThreadId: "review",
    originKind: "fork",
    originPluginId: "side-chat",
    visibility: "hidden",
    status: "active",
    runtime: { displayStatus: "active" },
    createdAt: 3,
  });
  const visibleChild = listEntry({ id: "visible", parentThreadId: "parent" });
  const { bb, harness } = createFakePluginHost({
    pluginId: "threadflow-hidden-children-test",
    sdk: {
      threads: {
        list: async ({ archived, includeHidden, hasParent, originKind }) => {
          if (archived !== false || includeHidden !== true) return [];
          if (hasParent === true) return [review, visibleChild];
          return originKind === "fork" ? [review, reply] : [];
        },
      },
    },
  });
  plugin(bb);

  assert.deepEqual(
    await harness.behavior.callRpc("hidden_child_threads", {}),
    {
      threads: [
        {
          id: "review",
          title: "Review",
          parentThreadId: "parent",
          createdAt: 2,
          status: "idle",
          needsAttention: false,
          backgroundWork: 2,
          queuedWork: "waiting",
          originKind: "fork",
          originPluginId: "chat-tools",
        },
        {
          id: "reply",
          title: "Replying to this earlier message",
          parentThreadId: "review",
          createdAt: 3,
          status: "active",
          needsAttention: false,
          backgroundWork: 0,
          queuedWork: "none",
          originKind: "fork",
          originPluginId: "side-chat",
        },
      ],
    },
  );
  await harness.lifecycle.dispose();
});

test("thread history exposes archive time and can restore a thread", async () => {
  const archivedAt = Date.now() - 1_000;
  const archivedThread = {
    ...makeThreadResponse({
      id: "thread-archived",
      title: "Finished work",
      archivedAt,
      queuedWork: "none",
      updatedAt: archivedAt,
    }),
    hasPendingInteraction: false,
  };
  let unarchivedThreadId: string | null = null;
  const { bb, harness } = createFakePluginHost({
    pluginId: "threadflow-history-test",
    sdk: {
      threads: {
        get: async () => archivedThread,
        list: async ({ archived }) => (archived ? [archivedThread] : []),
        queue: { list: async () => [] },
        unarchive: async ({ threadId }) => {
          unarchivedThreadId = threadId;
          return { ok: true };
        },
      },
      projects: { list: async () => [] },
      providers: { list: async () => [] },
    },
  });
  plugin(bb);
  assert.deepEqual(
    await harness.behavior.callRpc("toggle_archived", {
      id: archivedThread.id,
    }),
    {
      archived: false,
    },
  );
  assert.equal(unarchivedThreadId, archivedThread.id);
  await harness.lifecycle.dispose();
});

test("wait metadata exposes declared instruction-wait dependencies", async () => {
  const now = Date.now();
  const waitingThread = {
    ...makeThreadResponse({
      createdAt: now,
      id: "thread-waiting",
      queuedWork: "waiting",
      status: "idle",
      title: "Coordinator",
      updatedAt: now,
    }),
    hasPendingInteraction: false,
  };
  const dependency = {
    ...makeThreadResponse({
      createdAt: now,
      id: "thread-dependency",
      queuedWork: "none",
      status: "active",
      title: "Dependency",
      updatedAt: now,
    }),
    hasPendingInteraction: false,
  };
  const queuedRows: ReturnType<typeof makeQueueEntry>[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "threadflow-dependencies-test",
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          threadId === waitingThread.id ? waitingThread : dependency,
        list: async ({ archived, includeHidden }) =>
          archived === false && includeHidden === true
            ? [waitingThread, dependency]
            : [],
        send: async ({ threadId, input }) => {
          const queuedMessage = makeQueueEntry({
            id: "queue-waiting",
            threadId,
            content: input,
          });
          queuedRows.push(queuedMessage);
          return { ok: true, delivery: "queued", queuedMessage };
        },
        queuedMessages: {
          list: async ({ threadId }) =>
            queuedRows.filter((row) => row.threadId === threadId),
        },
        queue: { list: async () => queuedRows },
      },
      projects: { list: async () => [] },
      providers: { list: async () => [] },
    },
  });
  plugin(bb);
  await harness.behavior.callAgentTool(
    "threadflow_wait",
    {
      condition: {
        kind: "instruction",
        instruction:
          "Wait until the dependency has produced an acceptable result.",
        threadIds: [dependency.id],
      },
      timeoutMinutes: 60,
      resumePrompt: "Continue when the dependency is acceptable.",
    },
    { threadId: waitingThread.id },
  );

  const result = await harness.behavior.callRpc("wait_dependencies", {});

  assert.deepEqual(result.dependencies, [
    { waitingThreadId: waitingThread.id, targetThreadIds: [dependency.id] },
  ]);
  assert.deepEqual(
    result.dependencies.some((item) => item.waitingThreadId === dependency.id),
    false,
  );
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
      {
        type: "text",
        text: "Merge, wait for deployment, then test production.",
        mentions: [],
      },
      {
        type: "text",
        text: "hidden marker",
        mentions: [],
        visibility: "agent-only",
      },
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

  assert.deepEqual(
    await harness.behavior.callRpc("active_threadflow_wait", {
      threadId: thread.id,
    }),
    {
      wait: null,
      queuedWait: {
        id: entry.id,
        waitingKind: "time",
        reason:
          "This continuation will be sent automatically at the scheduled time.",
        message: "Merge, wait for deployment, then test production.",
        sendAt,
      },
    },
  );

  await harness.lifecycle.dispose();
});

test("workout scratchpad migrates once and persists in shared plugin storage", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "threadflow-scratchpad-storage-test",
  });
  plugin(bb);

  assert.deepEqual(
    await harness.behavior.callRpc("workout_scratchpad", {
      legacyContent: "Pushups: 30",
    }),
    { content: "Pushups: 30" },
  );

  const reloaded = await harness.lifecycle.reload(plugin);
  assert.deepEqual(
    await reloaded.harness.behavior.callRpc("workout_scratchpad", {
      legacyContent: "Pushups: stale device value",
    }),
    { content: "Pushups: 30" },
  );
  assert.deepEqual(
    await reloaded.harness.behavior.callRpc("save_workout_scratchpad", {
      content: "Pullups: 8",
    }),
    { ok: true },
  );
  assert.deepEqual(
    await reloaded.harness.behavior.callRpc("workout_scratchpad", {}),
    {
      content: "Pullups: 8",
    },
  );

  await reloaded.harness.lifecycle.dispose();
});
