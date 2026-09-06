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
const MINUTE_MS = 60_000;
const GITHUB_RUN_URL = "https://github.com/use-bogi/usebogi.com/actions/runs/33998698980";
const GITHUB_HEAD_SHA = "28b49da5b1ef555d3b125bbf8ca49e80fa1ae4a2";

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
  const secondTargetThread = makeThreadResponse({
    id: "thread-target-two",
    projectId: "project-test",
    environmentId: "environment-target-two",
    title: "Second dependency",
    status: "active",
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
  let targetThreadStatus = targetThread.status;
  let secondTargetThreadStatus = secondTargetThread.status;
  let pullRequestState = "open";
  let checkerOutput = '{"decision":"ready","evidence":"The dependency is available."}';
  let githubRun = {
    owner: "use-bogi",
    repository: "usebogi.com",
    runId: 33_998_698_980,
    runUrl: GITHUB_RUN_URL,
    workflowName: "Deploy Sandbox",
    headSha: GITHUB_HEAD_SHA,
    status: "in_progress",
    conclusion: null,
  };

  const host = createFakePluginHost({
    pluginId: PLUGIN_ID,
    sdk: {
      threads: {
        get: async ({ threadId }) => {
          if (threadId === sleepingThread.id) return sleepingThread;
          if (threadId === targetThread.id) return { ...targetThread, status: targetThreadStatus };
          if (threadId === secondTargetThread.id) return { ...secondTargetThread, status: secondTargetThreadStatus };
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
          if (args.startedOnBehalfOf !== null && args.startedOnBehalfOf !== undefined) {
            if (args.sourceThreadId === undefined && args.parentThreadId === undefined) {
              throw new Error("startedOnBehalfOf requires a sourceThreadId or parentThreadId");
            }
            if (args.originKind === null || args.originKind === undefined) {
              throw new Error("startedOnBehalfOf requires an originKind");
            }
          }
          spawnedWith.push(args);
          return workerThread;
        },
        wait: async () => ({
          matched: true,
          target: { kind: "status", status: "idle" },
          thread: workerThread,
          threadId: workerThread.id,
        }),
        output: async () => ({ output: checkerOutput }),
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
  const waitController = registerThreadflowWaits(host.bb, {
    excludedThreadTitlePrefixes: ["TLDR worker:"],
    inspectGithubWorkflowRun: async (identity) => {
      assert.equal(identity.runUrl, GITHUB_RUN_URL);
      return { ...githubRun };
    },
  });
  return {
    ...host,
    queuedRows,
    sleepingThread,
    secondTargetThread,
    spawnedWith,
    targetThread,
    waitController,
    workerThread,
    setPullRequestState(state) {
      pullRequestState = state;
    },
    setCheckerOutput(output) {
      checkerOutput = output;
    },
    setGithubRun(update) {
      githubRun = { ...githubRun, ...update };
    },
    setThreadStatus(threadId, status) {
      if (threadId === targetThread.id) targetThreadStatus = status;
      else if (threadId === secondTargetThread.id) secondTargetThreadStatus = status;
      else throw new Error(`Unknown thread ${threadId}`);
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

async function waitUntil(predicate, message) {
  const deadline = Date.now() + 2_000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(predicate(), message);
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
  const activeWait = await state.waitController.getActiveWait(state.sleepingThread.id);
  assert.equal(activeWait?.state, "waiting");
  assert.equal(activeWait?.label, "Waiting for “Dependency” to be archived");
  assert.deepEqual(activeWait?.condition, {
    kind: "thread_archived",
    targetThreadId: state.targetThread.id,
    targetTitle: state.targetThread.title,
  });

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

test("threads_idle waits for every target and wakes from idle events", async () => {
  const state = createWaitHost();
  state.setThreadStatus(state.targetThread.id, "active");
  const input = {
    condition: {
      kind: "threads_idle",
      threadIds: [state.targetThread.id, state.secondTargetThread.id],
    },
    timeoutMinutes: 60,
    resumePrompt: "Continue after both dependencies finish.",
  };
  const result = await state.harness.behavior.callAgentTool(
    "threadflow_wait",
    input,
    { threadId: state.sleepingThread.id },
  );
  assert.match(String(result), /Waiting for 2 threads to become idle/);
  assert.deepEqual((await state.waitController.getActiveWait(state.sleepingThread.id))?.condition, {
    kind: "threads_idle",
    targets: [
      { threadId: state.targetThread.id, title: "Dependency" },
      { threadId: state.secondTargetThread.id, title: "Second dependency" },
    ],
  });
  assert.match(
    (await state.waitController.getActiveWait(state.sleepingThread.id))?.lastEvidence ?? "",
    /Dependency.*active.*Second dependency.*active/,
  );

  state.setThreadStatus(state.targetThread.id, "idle");
  await state.harness.behavior.emitThreadEvent("thread.idle", {
    thread: { ...state.targetThread, status: "idle" },
    lastAssistantText: null,
  });
  assert.equal(state.harness.inspection.recheckCount, 0);
  assert.equal(
    (await state.waitController.getActiveWait(state.sleepingThread.id))?.lastEvidence,
    "Still running: “Second dependency” (active).",
  );

  state.setThreadStatus(state.secondTargetThread.id, "idle");
  await state.harness.behavior.emitThreadEvent("thread.idle", {
    thread: { ...state.secondTargetThread, status: "idle" },
    lastAssistantText: null,
  });
  assert.equal(state.harness.inspection.recheckCount, 1);
  const hook = state.harness.inspection.registrations.hooks["message.dispatch"];
  assert.ok(hook);
  assert.equal((await hook(dispatchContext(state.sleepingThread, state.queuedRows[0]))).action, "proceed");
  assert.equal(state.queuedRows[0].content[0].text, input.resumePrompt);
  await state.harness.lifecycle.dispose();
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

test("reading an active wait clears stale state after its queued continuation is cancelled", async () => {
  const state = createWaitHost();
  await state.harness.behavior.callAgentTool("threadflow_wait", {
    condition: { kind: "thread_archived", targetThreadId: state.targetThread.id },
    timeoutMinutes: 60,
    resumePrompt: "Continue.",
  }, { threadId: state.sleepingThread.id });
  assert.equal((await state.waitController.getActiveWait(state.sleepingThread.id))?.state, "waiting");

  state.queuedRows.splice(0);

  assert.equal(await state.waitController.getActiveWait(state.sleepingThread.id), null);
  const row = state.bb.storage.database().prepare(
    "SELECT state FROM threadflow_waits WHERE thread_id = ?",
  ).get(state.sleepingThread.id);
  assert.equal(row.state, "cancelled");
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

test("GitHub Actions waits inspect exact runs directly without spawning an agent", async () => {
  const state = createWaitHost();
  const result = await state.harness.behavior.callAgentTool("threadflow_wait", {
    condition: { kind: "github_actions_succeeded", runUrls: [GITHUB_RUN_URL] },
    timeoutMinutes: 60,
    resumePrompt: "Test the deployed sandbox now.",
  }, { threadId: state.sleepingThread.id });
  assert.match(String(result), /Deploy Sandbox/);
  assert.equal(state.spawnedWith.length, 0);

  state.setGithubRun({ status: "completed", conclusion: "success" });
  state.bb.storage.database().prepare("UPDATE threadflow_waits SET next_check_at = 0").run();
  const service = state.harness.behavior.runService("threadflow-wait-monitor");
  await waitForRecheck(state.harness);
  service.controller.abort();
  await service.done;

  assert.equal(state.queuedRows[0].content[0].text, "Test the deployed sandbox now.");
  assert.equal(state.spawnedWith.length, 0);
  await state.harness.lifecycle.dispose();
});

test("GitHub Actions waits wake on a terminal non-success conclusion", async () => {
  const state = createWaitHost();
  await state.harness.behavior.callAgentTool("threadflow_wait", {
    condition: { kind: "github_actions_succeeded", runUrls: [GITHUB_RUN_URL] },
    timeoutMinutes: 60,
    resumePrompt: "Test the deployed sandbox now.",
  }, { threadId: state.sleepingThread.id });
  state.setGithubRun({ status: "completed", conclusion: "failure" });
  state.bb.storage.database().prepare("UPDATE threadflow_waits SET next_check_at = 0").run();

  const service = state.harness.behavior.runService("threadflow-wait-monitor");
  await waitForRecheck(state.harness);
  service.controller.abort();
  await service.done;

  const row = state.bb.storage.database().prepare("SELECT result_json FROM threadflow_waits").get();
  assert.match(row.result_json, /condition_impossible/);
  assert.match(row.result_json, /conclusion failure/);
  assert.equal(state.spawnedWith.length, 0);
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
  assert.equal(state.spawnedWith[0].startedOnBehalfOf, undefined);
  assert.equal(state.harness.inspection.sdk.callsTo("threads.archive").length, 1);
  assert.equal(state.harness.inspection.sdk.callsTo("threads.stop").length, 1);
  await state.harness.lifecycle.dispose();
});

test("instruction waits first check at twenty minutes and then every forty-five minutes", async () => {
  const state = createWaitHost();
  state.setCheckerOutput('{"decision":"wait","evidence":"The dependency is still pending."}');
  const armedAt = Date.now();
  await state.harness.behavior.callAgentTool("threadflow_wait", {
    condition: { kind: "instruction", instruction: "The dependency is available." },
    timeoutMinutes: 120,
    resumePrompt: "Continue when the dependency is available.",
  }, { threadId: state.sleepingThread.id });

  const initial = state.bb.storage.database().prepare(
    "SELECT next_check_at FROM threadflow_waits WHERE thread_id = ?",
  ).get(state.sleepingThread.id);
  assert.ok(initial.next_check_at >= armedAt + 20 * MINUTE_MS);
  assert.ok(initial.next_check_at <= Date.now() + 20 * MINUTE_MS);

  state.bb.storage.database().prepare(
    "UPDATE threadflow_waits SET next_check_at = 0 WHERE thread_id = ?",
  ).run(state.sleepingThread.id);
  const checkedAt = Date.now();
  const service = state.harness.behavior.runService("threadflow-wait-monitor");
  await waitUntil(() => {
    const row = state.bb.storage.database().prepare(
      "SELECT next_check_at FROM threadflow_waits WHERE thread_id = ?",
    ).get(state.sleepingThread.id);
    return row.next_check_at >= checkedAt + 45 * MINUTE_MS;
  }, "instruction wait was not rescheduled");
  service.controller.abort();
  await service.done;

  const recheck = state.bb.storage.database().prepare(
    "SELECT next_check_at FROM threadflow_waits WHERE thread_id = ?",
  ).get(state.sleepingThread.id);
  assert.ok(recheck.next_check_at <= Date.now() + 45 * MINUTE_MS);
  assert.equal(state.harness.inspection.recheckCount, 0);
  await state.harness.lifecycle.dispose();
});
