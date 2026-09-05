import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceCompletionAlertState,
  getCompletionAlertSnapshot,
  initialCompletionAlertState,
  isCompletionWorkRunning,
  type CompletionAlertThread,
} from "./completion-alert.ts";

function thread(overrides: Partial<CompletionAlertThread> = {}): CompletionAlertThread {
  return {
    archivedAt: null,
    deletedAt: null,
    hasPendingInteraction: false,
    lastReadAt: null,
    latestAttentionAt: 10,
    originKind: null,
    sourceThreadId: null,
    status: "idle",
    visibility: "visible",
    ...overrides,
  };
}

test("does not alert for already-finished work on startup", () => {
  const result = advanceCompletionAlertState(initialCompletionAlertState, {
    hasAttention: true,
    hasRunningWork: false,
  });
  assert.equal(result.shouldAlert, false);
  assert.equal(result.state.armed, false);
});

test("alerts once when armed work finishes with unread attention", () => {
  const armed = advanceCompletionAlertState(initialCompletionAlertState, {
    hasAttention: false,
    hasRunningWork: true,
  });
  const finished = advanceCompletionAlertState(armed.state, {
    hasAttention: true,
    hasRunningWork: false,
  });
  const repeated = advanceCompletionAlertState(finished.state, {
    hasAttention: true,
    hasRunningWork: false,
  });

  assert.equal(finished.shouldAlert, true);
  assert.equal(repeated.shouldAlert, false);
});

test("does not alert when work finishes without anything needing attention", () => {
  const armed = advanceCompletionAlertState(initialCompletionAlertState, {
    hasAttention: false,
    hasRunningWork: true,
  });
  const finished = advanceCompletionAlertState(armed.state, {
    hasAttention: false,
    hasRunningWork: false,
  });
  assert.equal(finished.shouldAlert, false);
  assert.equal(finished.state.armed, false);
});

test("matches Threadflow work and attention semantics", () => {
  const runningSource = thread({ status: "active", latestAttentionAt: 0 });
  const pendingSource = thread({ status: "active", hasPendingInteraction: true });
  const readSource = thread({ lastReadAt: 10 });
  const runningSideChat = thread({
    latestAttentionAt: 0,
    originKind: "fork",
    sourceThreadId: "source",
    status: "active",
    visibility: "hidden",
  });
  const internalWorker = thread({
    latestAttentionAt: 0,
    status: "active",
    visibility: "hidden",
  });

  assert.equal(isCompletionWorkRunning(runningSource), true);
  assert.equal(isCompletionWorkRunning(pendingSource), false);
  assert.equal(isCompletionWorkRunning(runningSideChat), true);
  assert.equal(isCompletionWorkRunning(internalWorker), false);
  assert.deepEqual(getCompletionAlertSnapshot([readSource], [internalWorker]), {
    hasAttention: false,
    hasRunningWork: false,
  });
  assert.deepEqual(getCompletionAlertSnapshot([pendingSource, readSource], [internalWorker]), {
    hasAttention: true,
    hasRunningWork: false,
  });
});
