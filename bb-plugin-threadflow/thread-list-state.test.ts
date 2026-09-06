import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyThreadListState,
  nestWorkingThreadDependencies,
  type ThreadListStateInput,
} from "./thread-list-state.ts";

type TestThread = ThreadListStateInput & { id: string; waitingForThreadIds: string[] };

function thread(overrides: Partial<TestThread> = {}): TestThread {
  return {
    archived: false,
    id: "thread",
    needsAttention: false,
    queuedWork: "none" as const,
    sideChats: [],
    status: "idle",
    waitingForThreadIds: [],
    ...overrides,
  };
}

test("idle and pending queued work share the waiting state", () => {
  assert.equal(classifyThreadListState(thread({ queuedWork: "waiting" })), "waiting");
  assert.equal(classifyThreadListState(thread({ status: "pending", queuedWork: "waiting" })), "waiting");
});

test("active work takes precedence over a queued follow-up", () => {
  assert.equal(classifyThreadListState(thread({ status: "active", queuedWork: "waiting" })), "working");
  assert.equal(classifyThreadListState(thread({
    queuedWork: "waiting",
    sideChats: [{ needsAttention: false, running: true }],
  })), "working");
});

test("attention and failed queues remain needs-you states", () => {
  assert.equal(classifyThreadListState(thread({ needsAttention: true, queuedWork: "waiting" })), "needs-you");
  assert.equal(classifyThreadListState(thread({ status: "error", queuedWork: "waiting" })), "needs-you");
  assert.equal(classifyThreadListState(thread({ queuedWork: "failed" })), "needs-you");
});

test("working threads awaited by threads_idle nest under the waiting thread", () => {
  const dependency = thread({ id: "dependency", status: "active", waitingForThreadIds: [] });
  const unrelated = thread({ id: "unrelated", status: "active", waitingForThreadIds: [] });
  const parent = thread({
    id: "parent",
    queuedWork: "waiting",
    waitingForThreadIds: [dependency.id],
  });

  const layout = nestWorkingThreadDependencies([dependency, unrelated, parent]);

  assert.deepEqual(layout.topLevelThreads.map(({ id }) => id), [unrelated.id, parent.id]);
  assert.deepEqual(layout.dependenciesByParentId.get(parent.id)?.map(({ id }) => id), [dependency.id]);
});
