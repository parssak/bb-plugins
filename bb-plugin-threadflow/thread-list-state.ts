export type ThreadListStateInput = {
  archived: boolean;
  needsAttention: boolean;
  queuedWork: "none" | "waiting" | "failed";
  sideChats: readonly {
    needsAttention: boolean;
    running: boolean;
  }[];
  status: string;
};

export type ThreadListState = "needs-you" | "waiting" | "working";

const ACTIVE_STATUSES = new Set(["active", "starting", "stopping"]);

export function classifyThreadListState(thread: ThreadListStateInput): ThreadListState {
  const sideChatInProgress = thread.sideChats.some((sideChat) => (
    sideChat.running && !sideChat.needsAttention
  ));
  if (!thread.archived && (sideChatInProgress || !thread.needsAttention && ACTIVE_STATUSES.has(thread.status))) {
    return "working";
  }
  if (
    !thread.archived
    && !thread.needsAttention
    && thread.status !== "error"
    && thread.queuedWork === "waiting"
  ) {
    return "waiting";
  }
  return "needs-you";
}

export function threadIsWorking(thread: ThreadListStateInput): boolean {
  return classifyThreadListState(thread) === "working";
}

export function nestWorkingThreadDependencies<
  TThread extends ThreadListStateInput & { id: string; waitingForThreadIds: readonly string[] },
>(threads: readonly TThread[]): {
  topLevelThreads: TThread[];
  dependenciesByParentId: Map<string, TThread[]>;
} {
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  const claimedThreadIds = new Set<string>();
  const dependenciesByParentId = new Map<string, TThread[]>();
  for (const parent of threads) {
    if (classifyThreadListState(parent) !== "waiting") continue;
    const dependencies: TThread[] = [];
    for (const threadId of parent.waitingForThreadIds) {
      const dependency = threadById.get(threadId);
      if (
        dependency === undefined
        || claimedThreadIds.has(threadId)
        || classifyThreadListState(dependency) !== "working"
      ) continue;
      claimedThreadIds.add(threadId);
      dependencies.push(dependency);
    }
    if (dependencies.length > 0) dependenciesByParentId.set(parent.id, dependencies);
  }
  return {
    topLevelThreads: threads.filter((thread) => !claimedThreadIds.has(thread.id)),
    dependenciesByParentId,
  };
}
