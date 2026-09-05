export type CompletionAlertMode = "Off" | "Chime" | "Voice";

export type CompletionAlertThread = {
  archivedAt: number | null;
  deletedAt: number | null;
  hasPendingInteraction: boolean;
  lastReadAt: number | null;
  latestAttentionAt: number;
  originKind: "fork" | null;
  sourceThreadId: string | null;
  status: string;
  visibility: "hidden" | "visible";
};

export type CompletionAlertSnapshot = {
  hasAttention: boolean;
  hasRunningWork: boolean;
};

export type CompletionAlertState = {
  armed: boolean;
  initialized: boolean;
};

export const initialCompletionAlertState: CompletionAlertState = {
  armed: false,
  initialized: false,
};

export function isCompletionThreadRelevant(
  thread: Pick<CompletionAlertThread, "archivedAt" | "deletedAt" | "originKind" | "sourceThreadId" | "visibility">,
): boolean {
  if (thread.archivedAt !== null || thread.deletedAt !== null) return false;
  if (thread.visibility === "visible") return true;
  return thread.originKind === "fork" && thread.sourceThreadId !== null;
}

export function isCompletionWorkRunning(thread: CompletionAlertThread): boolean {
  return isCompletionThreadRelevant(thread)
    && !thread.hasPendingInteraction
    && thread.status !== "idle"
    && thread.status !== "error";
}

export function getCompletionAlertSnapshot(
  visibleThreads: readonly CompletionAlertThread[],
  hiddenForks: readonly CompletionAlertThread[],
): CompletionAlertSnapshot {
  const relevantVisible = visibleThreads.filter(isCompletionThreadRelevant);
  const relevantHiddenForks = hiddenForks.filter((thread) => (
    thread.visibility === "hidden" && isCompletionThreadRelevant(thread)
  ));
  return {
    hasRunningWork: [...relevantVisible, ...relevantHiddenForks].some(isCompletionWorkRunning),
    hasAttention: relevantVisible.some((thread) => (
      thread.hasPendingInteraction
      || thread.latestAttentionAt > 0
        && (thread.lastReadAt === null || thread.lastReadAt < thread.latestAttentionAt)
    )) || relevantHiddenForks.some((thread) => thread.hasPendingInteraction),
  };
}

export function advanceCompletionAlertState(
  state: CompletionAlertState,
  snapshot: CompletionAlertSnapshot,
): { state: CompletionAlertState; shouldAlert: boolean } {
  if (!state.initialized) {
    return {
      state: { initialized: true, armed: snapshot.hasRunningWork },
      shouldAlert: false,
    };
  }
  if (snapshot.hasRunningWork) {
    return {
      state: { initialized: true, armed: true },
      shouldAlert: false,
    };
  }
  return {
    state: { initialized: true, armed: false },
    shouldAlert: state.armed && snapshot.hasAttention,
  };
}
