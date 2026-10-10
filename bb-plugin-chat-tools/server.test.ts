import assert from "node:assert/strict";
import test from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.ts";

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
      environments: {
        pullRequest: async () => ({
          outcome: "available",
          pullRequest: { state: "open" },
        }),
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
