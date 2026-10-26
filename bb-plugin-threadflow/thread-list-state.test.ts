import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyThreadListState,
  nestWorkingThreadDependencies,
  type ThreadListStateInput,
  type ThreadTreeNode,
} from "./thread-list-state.ts";

type TestThread = ThreadListStateInput & { id: string; waitingForThreadIds: string[] };

function thread(overrides: Partial<TestThread> = {}): TestThread {
  return {
    archived: false,
    backgroundWork: 0,
    children: [],
    id: "thread",
    needsAttention: false,
    queuedWork: "none" as const,
    status: "idle",
    waitingForThreadIds: [],
    ...overrides,
  };
}

function child(overrides: Partial<ThreadTreeNode> = {}): ThreadTreeNode {
  return {
    backgroundWork: 0,
    children: [],
    needsAttention: false,
    queuedWork: "none",
    status: "idle",
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
    children: [child({ status: "active" })],
  })), "working");
});

test("a nested review or its background agents keep the root working", () => {
  assert.equal(classifyThreadListState(thread({
    children: [child({ children: [child({ status: "active" })] })],
  })), "working");
  assert.equal(classifyThreadListState(thread({
    children: [child({ backgroundWork: 2 })],
  })), "working");
  assert.equal(classifyThreadListState(thread({ backgroundWork: 1 })), "working");
  assert.equal(classifyThreadListState(thread({ children: [child()] })), "needs-you");
});

test("a send-later on a nested review snoozes its root thread", () => {
  assert.equal(classifyThreadListState(thread({
    children: [child({ queuedWork: "waiting" })],
  })), "waiting");
  assert.equal(classifyThreadListState(thread({
    children: [child({ children: [child({ queuedWork: "waiting" })] })],
  })), "waiting");
  assert.equal(classifyThreadListState(thread({
    children: [child({ queuedWork: "waiting" }), child({ status: "active" })],
  })), "working");
  assert.equal(classifyThreadListState(thread({
    children: [child({ queuedWork: "waiting" }), child({ needsAttention: true })],
  })), "needs-you");
  assert.equal(classifyThreadListState(thread({
    children: [child({ status: "error", queuedWork: "waiting" })],
  })), "needs-you");
  assert.equal(classifyThreadListState(thread({
    queuedWork: "failed",
    children: [child({ queuedWork: "waiting" })],
  })), "needs-you");
});

test("attention and failed queues remain needs-you states", () => {
  assert.equal(classifyThreadListState(thread({ needsAttention: true, queuedWork: "waiting" })), "needs-you");
  assert.equal(classifyThreadListState(thread({ status: "error", queuedWork: "waiting" })), "needs-you");
  assert.equal(classifyThreadListState(thread({ queuedWork: "failed" })), "needs-you");
});

test("a working child cannot hide a parent or sibling needing input", () => {
  assert.equal(classifyThreadListState(thread({
    needsAttention: true,
    children: [child({ status: "active" })],
  })), "needs-you");
  assert.equal(classifyThreadListState(thread({
    status: "active",
    children: [child({ needsAttention: true })],
  })), "needs-you");
  assert.equal(classifyThreadListState(thread({
    children: [child({ status: "active", children: [child({ needsAttention: true })] })],
  })), "needs-you");
});

test("working threads declared as wait dependencies nest under the waiting thread", () => {
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
