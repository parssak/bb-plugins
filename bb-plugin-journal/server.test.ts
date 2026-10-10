import assert from "node:assert/strict";
import test from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.ts";

test("journal entries persist by local date and empty days do not occupy storage", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "threadflow-journal-test",
  });
  plugin(bb);
  const dateKey = "2026-09-05";

  assert.deepEqual(
    await harness.behavior.callRpc("journal_entry", { dateKey }),
    { content: null },
  );
  assert.deepEqual(
    await harness.behavior.callRpc("save_journal_entry", {
      dateKey,
      content: "Finish the daily plan",
    }),
    { ok: true },
  );

  const reloaded = await harness.lifecycle.reload(plugin);
  assert.deepEqual(
    await reloaded.harness.behavior.callRpc("journal_entry", { dateKey }),
    {
      content: "Finish the daily plan",
    },
  );
  assert.deepEqual(
    await reloaded.harness.behavior.callRpc("save_journal_entry", {
      dateKey,
      content: "   ",
    }),
    { ok: true },
  );
  assert.deepEqual(
    await reloaded.harness.behavior.callRpc("journal_entry", { dateKey }),
    { content: null },
  );
  await assert.rejects(() =>
    reloaded.harness.behavior.callRpc("journal_entry", {
      dateKey: "2026-02-29",
    }),
  );

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
    content:
      "Plan the release\n\n[Review thread](threadflow://thread/thread-123)",
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
  assert.deepEqual(spawnArgs.environment, {
    type: "host",
    workspace: { type: "personal" },
  });
  assert.equal(spawnArgs.title, `Journal chat · ${dateKey}`);
  assert.equal(spawnArgs.visibility, "hidden");
  assert.equal(spawnArgs.input[0]?.visibility, "agent-only");
  assert.match(spawnArgs.input[0]?.text ?? "", /Plan the release/);
  assert.match(
    spawnArgs.input[0]?.text ?? "",
    /bb thread show THREAD_ID --json/,
  );
  assert.match(
    spawnArgs.input[0]?.text ?? "",
    /Always reply tersely, like a natural iMessage conversation/,
  );

  const reloaded = await harness.lifecycle.reload(plugin);
  assert.deepEqual(
    await reloaded.harness.behavior.callRpc("journal_chat", { dateKey }),
    {
      threadId: chatThread.id,
    },
  );
  assert.equal(
    reloaded.harness.inspection.sdk.callsTo("threads.spawn").length,
    0,
  );
  await reloaded.harness.lifecycle.dispose();
});

test("journal thread statuses distinguish archived and in-progress links", async () => {
  const archived = makeThreadResponse({
    id: "thread-archived",
    archivedAt: Date.now(),
  });
  const working = makeThreadResponse({
    id: "thread-working",
    status: "active",
  });
  const waiting = makeThreadResponse({
    id: "thread-waiting",
    queuedWork: "waiting",
  });
  const needsAttention = makeThreadResponse({
    id: "thread-needs-attention",
    hasPendingInteraction: true,
    queuedWork: "waiting",
  });
  const sourceWithWorkingSideChat = makeThreadResponse({
    id: "thread-with-side-chat",
  });
  const workingSideChat = makeThreadResponse({
    id: "thread-side-chat",
    sourceThreadId: sourceWithWorkingSideChat.id,
    originKind: "fork",
    status: "active",
    visibility: "hidden",
  });
  const threads = new Map(
    [archived, working, waiting, needsAttention, sourceWithWorkingSideChat].map(
      (thread) => [thread.id, thread],
    ),
  );
  const { bb, harness } = createFakePluginHost({
    pluginId: "threadflow-journal-status-test",
    sdk: {
      threads: {
        get: async ({ threadId }) => {
          const thread = threads.get(threadId);
          if (thread === undefined) throw new Error("Thread not found");
          return thread;
        },
        list: async () =>
          [...threads.values()]
            .filter((thread) => thread.archivedAt === null)
            .concat(workingSideChat),
      },
    },
  });
  plugin(bb);

  assert.deepEqual(
    await harness.behavior.callRpc("journal_thread_statuses", {
      threadIds: [
        archived.id,
        working.id,
        waiting.id,
        needsAttention.id,
        sourceWithWorkingSideChat.id,
        "thread-missing",
        archived.id,
      ],
    }),
    {
      statuses: [
        { threadId: archived.id, status: "archived" },
        { threadId: working.id, status: "in-progress" },
        { threadId: waiting.id, status: "in-progress" },
        { threadId: sourceWithWorkingSideChat.id, status: "in-progress" },
      ],
    },
  );

  await harness.lifecycle.dispose();
});
