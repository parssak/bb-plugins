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
          archived === false && includeHidden === true ? [scheduledThread] : []
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
  assert.deepEqual(result.threads[0]?.waitingForThreadIds, []);
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
        list: async ({ archived }) => archived ? [archivedThread] : [],
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

  const result = await harness.behavior.callRpc("threads", { scope: "all", query: "" });
  assert.equal(result.threads[0]?.archivedAt, archivedAt);
  assert.deepEqual(await harness.behavior.callRpc("toggle_archived", { id: archivedThread.id }), {
    archived: false,
  });
  assert.equal(unarchivedThreadId, archivedThread.id);
  await harness.lifecycle.dispose();
});

test("thread list nests every active child under its canonical parent", async () => {
  const now = Date.now();
  const pluginId = "threadflow-review-sidebar-test";
  const sourceThread = {
    ...makeThreadResponse({
      id: "thread-source",
      createdAt: now,
      updatedAt: now,
      queuedWork: "none",
    }),
    hasPendingInteraction: false,
  };
  const reviewThread = {
    ...makeThreadResponse({
      id: "thread-review",
      createdAt: now + 1,
      updatedAt: now + 2,
      sourceThreadId: sourceThread.id,
      parentThreadId: sourceThread.id,
      title: "Review",
      visibility: "hidden",
      originKind: "fork",
      originPluginId: pluginId,
      status: "idle",
    }),
    hasPendingInteraction: false,
  };
  const ordinaryIdleSideChat = {
    ...reviewThread,
    id: "thread-idle-side-chat",
    title: "Side chat 2",
  };
  const visibleChild = {
    ...makeThreadResponse({
      id: "thread-visible-child",
      createdAt: now + 3,
      updatedAt: now + 4,
      parentThreadId: sourceThread.id,
      sourceThreadId: null,
      title: "Delegated task",
      visibility: "visible",
      status: "idle",
    }),
    hasPendingInteraction: false,
  };
  const hiddenRoot = makeThreadResponse({
    id: "thread-hidden-root",
    createdAt: now + 5,
    updatedAt: now + 6,
    title: "Internal worker",
    visibility: "hidden",
    status: "idle",
  });
  const { bb, harness } = createFakePluginHost({
    pluginId,
    sdk: {
      threads: {
        list: async ({ archived, includeHidden }) => {
          if (archived === false && includeHidden === true) {
            return [sourceThread, reviewThread, ordinaryIdleSideChat, visibleChild, hiddenRoot];
          }
          return [];
        },
        queue: { list: async () => [] },
      },
      projects: { list: async () => [] },
      providers: { list: async () => [] },
    },
  });
  plugin(bb);

  const result = await harness.behavior.callRpc("threads", { scope: "recent", query: "" });
  assert.deepEqual(result.threads[0]?.sideChats, [{
    id: reviewThread.id,
    title: "Review",
    sourceThreadId: sourceThread.id,
    createdAt: reviewThread.createdAt,
    needsAttention: false,
    running: false,
    closeable: true,
  }, {
    id: ordinaryIdleSideChat.id,
    title: ordinaryIdleSideChat.title,
    sourceThreadId: sourceThread.id,
    createdAt: ordinaryIdleSideChat.createdAt,
    needsAttention: false,
    running: false,
    closeable: true,
  }, {
    id: visibleChild.id,
    title: visibleChild.title,
    sourceThreadId: sourceThread.id,
    createdAt: visibleChild.createdAt,
    needsAttention: false,
    running: false,
    closeable: false,
  }]);
  assert.equal(result.threads.some((thread) => thread.id === visibleChild.id), false);
  assert.equal(result.threads.some((thread) => thread.id === hiddenRoot.id), false);
  await harness.lifecycle.dispose();
});

test("thread list RPC exposes declared instruction-wait dependencies", async () => {
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
        get: async ({ threadId }) => threadId === waitingThread.id ? waitingThread : dependency,
        list: async ({ archived, includeHidden }) => (
          archived === false && includeHidden === true ? [waitingThread, dependency] : []
        ),
        send: async ({ threadId, input }) => {
          const queuedMessage = makeQueueEntry({
            id: "queue-waiting",
            threadId,
            content: input,
          });
          queuedRows.push(queuedMessage);
          return { ok: true, delivery: "queued", queuedMessage };
        },
        queuedMessages: { list: async ({ threadId }) => queuedRows.filter((row) => row.threadId === threadId) },
        queue: { list: async () => queuedRows },
      },
      projects: { list: async () => [] },
      providers: { list: async () => [] },
    },
  });
  plugin(bb);
  await harness.behavior.callAgentTool("threadflow_wait", {
    condition: {
      kind: "instruction",
      instruction: "Wait until the dependency has produced an acceptable result.",
      threadIds: [dependency.id],
    },
    timeoutMinutes: 60,
    resumePrompt: "Continue when the dependency is acceptable.",
  }, { threadId: waitingThread.id });

  const result = await harness.behavior.callRpc("threads", { scope: "recent", query: "" });

  assert.deepEqual(
    result.threads.find((thread) => thread.id === waitingThread.id)?.waitingForThreadIds,
    [dependency.id],
  );
  assert.deepEqual(
    result.threads.find((thread) => thread.id === dependency.id)?.waitingForThreadIds,
    [],
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

test("worktree changes use the environment base when status has no merge-base details", async () => {
  const thread = makeThreadResponse({ id: "thread-changes", environmentId: "environment-changes" });
  const { bb, harness } = createFakePluginHost({
    pluginId: "threadflow-worktree-changes-test",
    sdk: {
      threads: { get: async () => thread },
      environments: {
        get: async () => ({
          baseBranch: "origin/main",
          branchName: "bb/thread-changes",
          createdAt: 1,
          defaultBranch: "main",
          hostId: "host-1",
          id: "environment-changes",
          isGitRepo: true,
          isWorktree: true,
          managed: true,
          mergeBaseBranch: null,
          name: null,
          path: "/workspace",
          projectId: "project-1",
          status: "ready",
          updatedAt: 1,
          workspaceProvisionType: "managed-worktree",
        }),
        status: async () => ({
          outcome: "available",
          workspace: {
            branch: { currentBranch: "bb/thread-changes", defaultBranch: "main" },
            checkout: { kind: "branch", branchName: "bb/thread-changes", headSha: "abc123" },
            mergeBase: null,
            workingTree: {
              deletions: 2,
              files: [],
              hasUncommittedChanges: true,
              insertions: 3,
              lineStatsComplete: true,
              state: "dirty_uncommitted",
            },
          },
        }),
        diffFiles: async () => ({
          outcome: "available",
          files: [{
            additions: 3,
            binary: false,
            deletions: 2,
            origin: "tracked",
            path: "server.ts",
            previousPath: null,
            statusLetter: "M",
          }],
          mergeBaseRef: "origin/main",
          shortstat: "1 file changed, 3 insertions(+), 2 deletions(-)",
          truncated: false,
        }),
      },
    },
  });
  plugin(bb);

  assert.deepEqual(await harness.behavior.callRpc("worktree_changes", { threadId: thread.id }), {
    changes: { baseBranch: "origin/main", fileCount: 1, additions: 3, deletions: 2 },
  });
  assert.equal(
    (harness.inspection.sdk.callsTo("environments.diffFiles")[0]?.[0] as { mergeBaseBranch: string }).mergeBaseBranch,
    "origin/main",
  );
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

test("journal chats persist by date and receive hidden page context", async () => {
  const pluginId = "threadflow-journal-chat-test";
  const dateKey = "2026-09-07";
  const personalProject = {
    id: "personal-project",
    kind: "personal" as const,
    name: "Personal",
    createdAt: 0,
    updatedAt: 0,
    gitRemoteUrl: null,
    sources: [],
  };
  const chatThread = makeThreadResponse({
    id: "journal-chat-thread",
    projectId: personalProject.id,
    title: `Journal chat · ${dateKey}`,
    visibility: "hidden",
    originPluginId: pluginId,
  });
  const { bb, harness } = createFakePluginHost({
    pluginId,
    sdk: {
      projects: { list: async () => [personalProject] },
      threads: {
        get: async () => chatThread,
        spawn: async () => chatThread,
      },
    },
  });
  plugin(bb);
  await harness.behavior.callRpc("save_journal_entry", {
    dateKey,
    content: "Plan the release\n\n[Review thread](threadflow://thread/thread-123)",
  });

  const results = await Promise.all([
    harness.behavior.callRpc("journal_chat", { dateKey }),
    harness.behavior.callRpc("journal_chat", { dateKey }),
  ]);
  assert.deepEqual(results, [
    { threadId: chatThread.id },
    { threadId: chatThread.id },
  ]);
  const spawnCalls = harness.inspection.sdk.callsTo("threads.spawn");
  assert.equal(spawnCalls.length, 1);
  const spawnArgs = spawnCalls[0]?.[0] as {
    projectId: string;
    environment: unknown;
    input: Array<{ text: string; visibility?: string }>;
    title: string;
    visibility: string;
  };
  assert.equal(spawnArgs.projectId, personalProject.id);
  assert.deepEqual(spawnArgs.environment, { type: "host", workspace: { type: "personal" } });
  assert.equal(spawnArgs.title, `Journal chat · ${dateKey}`);
  assert.equal(spawnArgs.visibility, "hidden");
  assert.equal(spawnArgs.input[0]?.visibility, "agent-only");
  assert.match(spawnArgs.input[0]?.text ?? "", /Plan the release/);
  assert.match(spawnArgs.input[0]?.text ?? "", /bb thread show THREAD_ID --json/);
  assert.match(spawnArgs.input[0]?.text ?? "", /Always reply tersely, like a natural iMessage conversation/);

  const reloaded = await harness.lifecycle.reload(plugin);
  assert.deepEqual(await reloaded.harness.behavior.callRpc("journal_chat", { dateKey }), {
    threadId: chatThread.id,
  });
  assert.equal(reloaded.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
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
