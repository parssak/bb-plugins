import assert from "node:assert/strict";
import test from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.ts";

const openPullRequest = {
  number: 42,
  title: "Test PR",
  url: "https://github.com/example/repo/pull/42",
  state: "open",
  attention: "checks_pending",
  checks: { state: "pending", totalCount: 2, failedCount: 0, pendingCount: 1 },
};

test("worktree changes use the environment base when status has no merge-base details", async () => {
  const thread = makeThreadResponse({
    id: "thread-changes",
    environmentId: "environment-changes",
  });
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
            branch: {
              currentBranch: "bb/thread-changes",
              defaultBranch: "main",
            },
            checkout: {
              kind: "branch",
              branchName: "bb/thread-changes",
              headSha: "abc123",
            },
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
          files: [
            {
              additions: 3,
              binary: false,
              deletions: 2,
              origin: "tracked",
              path: "server.ts",
              previousPath: null,
              statusLetter: "M",
            },
          ],
          mergeBaseRef: "origin/main",
          shortstat: "1 file changed, 3 insertions(+), 2 deletions(-)",
          truncated: false,
        }),
      },
    },
  });
  plugin(bb);

  assert.deepEqual(
    await harness.behavior.callRpc("worktree_changes", { threadId: thread.id }),
    {
      changes: {
        baseBranch: "origin/main",
        fileCount: 1,
        additions: 3,
        deletions: 2,
      },
    },
  );
  assert.equal(
    (
      harness.inspection.sdk.callsTo("environments.diffFiles")[0]?.[0] as {
        mergeBaseBranch: string;
      }
    ).mergeBaseBranch,
    "origin/main",
  );
  await harness.lifecycle.dispose();
});

test("automatic reviews are claimed once while manual reviews remain available", async () => {
  const sourceThread = makeThreadResponse({
    id: "thread-source",
    sourceThreadId: null,
    environmentId: "environment-source",
  });
  const reviewThread = makeThreadResponse({
    id: "thread-review",
    sourceThreadId: sourceThread.id,
    parentThreadId: sourceThread.id,
    title: "Review",
    visibility: "hidden",
    originKind: "fork",
    originPluginId: "threadflow-test",
  });
  let failFork = true;
  const { bb, harness } = createFakePluginHost({
    pluginId: "threadflow-test",
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          threadId === sourceThread.id ? sourceThread : reviewThread,
        list: async () => [],
        fork: async () => {
          if (failFork) throw new Error("Temporary fork failure");
          return reviewThread;
        },
        update: async () => reviewThread,
        timeline: async () => ({ rows: [] }),
      },
      plugins: {
        callRpc: async ({ pluginId, method, input, outputSchema }) => {
          assert.equal(pluginId, "bb--github-pr-status");
          assert.equal(method, "pullRequests");
          assert.deepEqual(input, { keys: [sourceThread.environmentId] });
          return outputSchema.parse({
            [sourceThread.environmentId!]: { outcome: "available", pullRequest: openPullRequest },
          });
        },
      },
    },
  });
  plugin(bb);

  const input = { sourceThreadId: sourceThread.id };
  await assert.rejects(
    harness.behavior.callRpc("create_automatic_review", input),
    /Temporary fork failure/,
  );
  failFork = false;
  const results = await Promise.all([
    harness.behavior.callRpc("create_automatic_review", input),
    harness.behavior.callRpc("create_automatic_review", input),
  ]);
  assert.deepEqual(
    results.map((result) => (result as { status: string }).status).sort(),
    ["already_claimed", "started"],
  );
  assert.equal(harness.inspection.sdk.callsTo("threads.fork").length, 2);

  const reloaded = await harness.lifecycle.reload(plugin);
  assert.deepEqual(
    await reloaded.harness.behavior.callRpc("create_automatic_review", input),
    { status: "already_claimed" },
  );
  assert.equal(
    reloaded.harness.inspection.sdk.callsTo("threads.fork").length,
    0,
  );

  await reloaded.harness.behavior.callRpc("create_side_chat", {
    sourceThreadId: sourceThread.id,
    initialMessage: "Review the changes in this worktree",
    title: "Review",
  });
  assert.equal(
    reloaded.harness.inspection.sdk.callsTo("threads.fork").length,
    1,
  );

  // Completion drives automation without mounting any frontend component.
  await reloaded.bb.storage.kv.delete(
    `automatic-review-claim:${sourceThread.id}`,
  );
  await reloaded.harness.behavior.emitThreadEvent("thread.idle", {
    thread: sourceThread,
    lastAssistantText: null,
  });
  assert.equal(
    reloaded.harness.inspection.sdk.callsTo("threads.fork").length,
    2,
  );

  await reloaded.harness.lifecycle.dispose();
});

for (const scenario of ["open", "draft", "merged", "closed", "absent", "unavailable", "missing", "error"] as const) {
  test(`idle review trigger handles PR lookup: ${scenario}`, async () => {
    const source = makeThreadResponse({ id: "source", environmentId: "env", sourceThreadId: null, parentThreadId: null });
    const review = makeThreadResponse({ id: "review", sourceThreadId: source.id, parentThreadId: source.id });
    let lookupFails = scenario === "error";
    const { bb, harness } = createFakePluginHost({
      pluginId: "chat-tools",
      sdk: {
        plugins: {
          callRpc: async ({ outputSchema }) => {
            if (lookupFails) throw new Error("PR plugin unavailable");
            const result = scenario === "absent" ? { outcome: "absent" }
              : scenario === "unavailable" ? { outcome: "unavailable", message: "Host offline" }
              : { outcome: "available", pullRequest: { ...openPullRequest, state: scenario === "error" ? "open" : scenario } };
            return outputSchema.parse(scenario === "missing" ? {} : { env: result });
          },
        },
        threads: {
          get: async ({ threadId }) => threadId === source.id ? source : review,
          list: async () => [],
          fork: async () => review,
          update: async () => review,
          timeline: async () => ({ rows: [] }),
        },
      },
    });
    plugin(bb);
    try {
      const idle = () => harness.behavior.emitThreadEvent("thread.idle", { thread: source, lastAssistantText: null });
      await idle();
      const shouldStart = scenario === "open" || scenario === "draft";
      assert.equal(harness.inspection.sdk.callsTo("threads.fork").length, shouldStart ? 1 : 0);
      await idle();
      assert.equal(harness.inspection.sdk.callsTo("threads.fork").length, shouldStart ? 1 : 0);
      assert.equal(await bb.storage.kv.get(`automatic-review-claim:${source.id}`) !== undefined, shouldStart);
      if (scenario === "error") {
        lookupFails = false;
        await idle();
        assert.equal(harness.inspection.sdk.callsTo("threads.fork").length, 1);
      }
      const checks = await harness.behavior.callRpc("pull_request_checks", { threadId: source.id });
      assert.deepEqual(checks, { checks: ["absent", "unavailable", "missing"].includes(scenario) ? null : openPullRequest.checks });
    } finally {
      await harness.lifecycle.dispose();
    }
  });
}
