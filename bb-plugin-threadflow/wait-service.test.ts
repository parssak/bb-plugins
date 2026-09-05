import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakePluginHost,
  makeMessageDispatchHookContext,
  makePluginAgentConfigurationContext,
  makeQueueEntry,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";

import { registerThreadflowWaits, WAIT_CHECKER_TITLE_PREFIX } from "./wait-service.ts";

const PLUGIN_ID = "threadflow-test";

function createWaitHost() {
  const sleepingThread = makeThreadResponse({
    id: "thread-sleeping",
    projectId: "project-test",
    environmentId: "environment-test",
    title: "Sleeping work",
    status: "working",
  });
  const targetThread = makeThreadResponse({
    id: "thread-target",
    projectId: "project-test",
    environmentId: "environment-target",
    title: "Dependency",
  });
  const workerThread = makeThreadResponse({
    id: "thread-checker",
    projectId: "project-test",
    environmentId: "environment-test",
    title: `${WAIT_CHECKER_TITLE_PREFIX} test`,
    visibility: "hidden",
    originKind: "spawn",
    originPluginId: PLUGIN_ID,
  });
  const queuedRows = [];
  const spawnedWith = [];
  let nextQueueId = 1;
  let pullRequestState = "open";

  const host = createFakePluginHost({
    pluginId: PLUGIN_ID,
    sdk: {
      threads: {
        get: async ({ threadId }) => {
          if (threadId === sleepingThread.id) return sleepingThread;
          if (threadId === targetThread.id) return targetThread;
          if (threadId === workerThread.id) return workerThread;
          throw new Error(`Unknown thread ${threadId}`);
        },
        list: async () => [],
        send: async ({ threadId, input }) => {
          const queuedMessage = makeQueueEntry({
            id: `queued-${nextQueueId++}`,
            threadId,
            content: input,
            updatedAt: Date.now(),
          });
          queuedRows.push(queuedMessage);
          return { ok: true, delivery: "queued", queuedMessage };
        },
        queuedMessages: {
          list: async ({ threadId }) => queuedRows.filter((row) => row.threadId === threadId),
          update: async ({ threadId, queuedMessageId, expectedUpdatedAt, input }) => {
            const index = queuedRows.findIndex((row) => row.threadId === threadId && row.id === queuedMessageId);
            if (index < 0) throw new Error("Queued message not found");
            if (queuedRows[index].updatedAt !== expectedUpdatedAt) throw new Error("Queued message changed");
            queuedRows[index] = { ...queuedRows[index], content: input, updatedAt: expectedUpdatedAt + 1 };
            return queuedRows[index];
          },
          delete: async ({ threadId, queuedMessageId }) => {
            const index = queuedRows.findIndex((row) => row.threadId === threadId && row.id === queuedMessageId);
            if (index >= 0) queuedRows.splice(index, 1);
            return { ok: true };
          },
        },
        queue: {
          list: async () => [...queuedRows],
        },
        spawn: async (args) => {
          spawnedWith.push(args);
          return workerThread;
        },
        wait: async () => ({
          matched: true,
          target: { kind: "status", status: "idle" },
          thread: workerThread,
          threadId: workerThread.id,
        }),
        output: async () => ({ output: '{"decision":"ready","evidence":"The dependency is available."}' }),
        archive: async () => ({ archivedThreadIds: [workerThread.id] }),
        stop: async () => ({ ok: true }),
      },
      environments: {
        pullRequest: async () => ({
          outcome: "available",
          pullRequest: {
            attention: pullRequestState === "merged" ? "merged" : "none",
            baseRefName: "main",
            checks: { failedCount: 0, passedCount: 1, pendingCount: 0, state: "passing", totalCount: 1 },
            headRefName: "dependency",
            mergeability: { mergeStateStatus: "CLEAN", mergeable: "MERGEABLE", state: "mergeable" },
            number: 42,
            review: { reviewRequestCount: 0, state: "approved" },
            state: pullRequestState,
            title: "Dependency",
            updatedAt: new Date(0).toISOString(),
            url: "https://github.example/pull/42",
          },
        }),
      },
    },
  });
  registerThreadflowWaits(host.bb, { excludedThreadTitlePrefixes: ["TLDR worker:"] });
  return {
    ...host,
    queuedRows,
    sleepingThread,
    spawnedWith,
    targetThread,
    workerThread,
    setPullRequestState(state) {
      pullRequestState = state;
    },
  };
}

function dispatchContext(thread, queuedMessage) {
  return makeMessageDispatchHookContext({
    thread,
    environment: { id: thread.environmentId },
    input: { blocks: queuedMessage.content },
    queuedMessage,
  });
}

async function waitForRecheck(harness) {
  const deadline = Date.now() + 2_000;
  while (harness.inspection.recheckCount === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(harness.inspection.recheckCount > 0, "wait monitor did not request a dispatch recheck");
}

test("threadflow waits are atomic, durable across reload, and released by target events", async () => {
  const state = createWaitHost();
  const input = {
    condition: { kind: "thread_archived", targetThreadId: state.targetThread.id },
    timeoutMinutes: 60,
    resumePrompt: "Continue after the dependency finishes.",
  };
  const results = await Promise.all([
    state.harness.behavior.callAgentTool("threadflow_wait", input, { threadId: state.sleepingThread.id }),
    state.harness.behavior.callAgentTool("threadflow_wait", input, { threadId: state.sleepingThread.id }),
  ]);
  assert.equal(results.filter((result) => String(result).includes(" armed:")).length, 1);
  assert.equal(results.filter((result) => String(result).includes("already sleeping")).length, 1);
  assert.equal(state.harness.inspection.sdk.callsTo("threads.send").length, 1);

  const initialHook = state.harness.inspection.registrations.hooks["message.dispatch"];
  assert.ok(initialHook);
  assert.equal(
    (await initialHook(dispatchContext(state.sleepingThread, state.queuedRows[0]))).action,
    "wait",
  );

  const reloaded = await state.harness.lifecycle.reload((bb) => {
    registerThreadflowWaits(bb, { excludedThreadTitlePrefixes: ["TLDR worker:"] });
  });
  const reloadedHook = reloaded.harness.inspection.registrations.hooks["message.dispatch"];
  assert.ok(reloadedHook);
  assert.equal(
    (await reloadedHook(dispatchContext(state.sleepingThread, state.queuedRows[0]))).action,
    "wait",
  );

  await reloaded.harness.behavior.emitThreadEvent("thread.archived", {
    thread: { ...state.targetThread, archivedAt: Date.now() },
  });
  assert.equal(reloaded.harness.inspection.recheckCount, 1);
  assert.equal(
    (await reloadedHook(dispatchContext(state.sleepingThread, state.queuedRows[0]))).action,
    "proceed",
  );
  assert.equal(state.queuedRows[0].content[0].text, input.resumePrompt);

  await reloaded.harness.lifecycle.dispose();
});

test("manual dispatch completes a wait and permits another wait", async () => {
  const state = createWaitHost();
  const input = {
    condition: { kind: "thread_archived", targetThreadId: state.targetThread.id },
    timeoutMinutes: 60,
    resumePrompt: "Continue.",
  };
  await state.harness.behavior.callAgentTool("threadflow_wait", input, { threadId: state.sleepingThread.id });
  const firstQueued = state.queuedRows.shift();
  await state.harness.behavior.emitThreadEvent("message.dispatched", { entry: firstQueued });
  const second = await state.harness.behavior.callAgentTool("threadflow_wait", input, { threadId: state.sleepingThread.id });
  assert.match(String(second), / armed:/);
  assert.equal(state.harness.inspection.sdk.callsTo("threads.send").length, 2);
  await state.harness.lifecycle.dispose();
});

test("timeouts wake with a bounded failure prompt", async () => {
  const state = createWaitHost();
  await state.harness.behavior.callAgentTool("threadflow_wait", {
    condition: { kind: "thread_archived", targetThreadId: state.targetThread.id },
    timeoutMinutes: 60,
    resumePrompt: "Continue.",
  }, { threadId: state.sleepingThread.id });
  state.bb.storage.database().prepare("UPDATE threadflow_waits SET deadline_at = 0").run();

  const service = state.harness.behavior.runService("threadflow-wait-monitor");
  await waitForRecheck(state.harness);
  service.controller.abort();
  await service.done;
  assert.equal(state.queuedRows[0].content[0].text, "The Threadflow wait ended without satisfying its condition. Reassess the blocker before continuing.");

  const hook = state.harness.inspection.registrations.hooks["message.dispatch"];
  assert.ok(hook);
  assert.equal((await hook(dispatchContext(state.sleepingThread, state.queuedRows[0]))).action, "proceed");
  await state.harness.lifecycle.dispose();
});

test("pull request waits stay bound to the PR resolved when armed", async () => {
  const state = createWaitHost();
  await state.harness.behavior.callAgentTool("threadflow_wait", {
    condition: { kind: "pull_request_merged", targetThreadId: state.targetThread.id },
    timeoutMinutes: 60,
    resumePrompt: "Pull the merged dependency and continue.",
  }, { threadId: state.sleepingThread.id });
  state.setPullRequestState("merged");
  state.bb.storage.database().prepare("UPDATE threadflow_waits SET next_check_at = 0").run();

  const service = state.harness.behavior.runService("threadflow-wait-monitor");
  await waitForRecheck(state.harness);
  service.controller.abort();
  await service.done;

  assert.equal(state.queuedRows[0].content[0].text, "Pull the merged dependency and continue.");
  assert.equal(state.harness.inspection.sdk.callsTo("environments.pullRequest").length, 2);
  await state.harness.lifecycle.dispose();
});

test("instruction waits use a hidden Spark checker and do not expose wait tools to helper agents", async () => {
  const state = createWaitHost();
  const normalConfig = await state.harness.behavior.resolveAgentConfiguration(
    makePluginAgentConfigurationContext(),
  );
  assert.deepEqual(normalConfig.tools.map((tool) => tool.name), ["threadflow_wait"]);
  const checkerConfig = await state.harness.behavior.resolveAgentConfiguration(
    makePluginAgentConfigurationContext({
      thread: { title: `${WAIT_CHECKER_TITLE_PREFIX} abc` },
      origin: { pluginId: PLUGIN_ID },
    }),
  );
  assert.deepEqual(checkerConfig.tools, []);

  await state.harness.behavior.callAgentTool("threadflow_wait", {
    condition: { kind: "instruction", instruction: "The dependency is available." },
    timeoutMinutes: 60,
    resumePrompt: "Verify the dependency once, then continue.",
  }, { threadId: state.sleepingThread.id });
  state.bb.storage.database().prepare("UPDATE threadflow_waits SET next_check_at = 0").run();

  const service = state.harness.behavior.runService("threadflow-wait-monitor");
  await waitForRecheck(state.harness);
  service.controller.abort();
  await service.done;

  assert.equal(state.spawnedWith.length, 1);
  assert.equal(state.spawnedWith[0].model, "gpt-5.3-codex-spark");
  assert.equal(state.spawnedWith[0].reasoningLevel, "low");
  assert.equal(state.spawnedWith[0].permissionMode, "auto");
  assert.equal(state.spawnedWith[0].visibility, "hidden");
  assert.equal(state.harness.inspection.sdk.callsTo("threads.archive").length, 1);
  assert.equal(state.harness.inspection.sdk.callsTo("threads.stop").length, 1);
  await state.harness.lifecycle.dispose();
});
