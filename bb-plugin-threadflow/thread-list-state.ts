export type ThreadTreeNode = {
  needsAttention: boolean;
  status: string;
  /** Background agents and workflows still running for the thread. */
  backgroundWork: number;
  queuedWork: "none" | "waiting" | "failed";
  children: readonly ThreadTreeNode[];
};

export type ThreadListStateInput = ThreadTreeNode & {
  archived: boolean;
};

export type ThreadListState = "needs-you" | "waiting" | "working";

const ACTIVE_STATUSES = new Set(["active", "starting", "stopping"]);

export function threadIsRunning(thread: Pick<ThreadTreeNode, "status" | "backgroundWork">): boolean {
  return ACTIVE_STATUSES.has(thread.status) || thread.backgroundWork > 0;
}

export function threadTreeNeedsAttention(thread: ThreadTreeNode): boolean {
  return thread.needsAttention || thread.children.some(threadTreeNeedsAttention);
}

/** A thread is working while it or any nested child thread still runs. */
export function threadTreeIsWorking(thread: ThreadTreeNode): boolean {
  return threadIsRunning(thread) || thread.children.some(threadTreeIsWorking);
}

function threadHasScheduledWork(thread: ThreadTreeNode): boolean {
  return thread.status !== "error" && thread.queuedWork === "waiting";
}

/** A send-later on a nested review or side chat snoozes its root thread too. */
export function threadTreeHasScheduledWork(thread: ThreadTreeNode): boolean {
  return threadHasScheduledWork(thread) || thread.children.some(threadTreeHasScheduledWork);
}

export function classifyThreadListState(thread: ThreadListStateInput): ThreadListState {
  if (threadTreeNeedsAttention(thread)) return "needs-you";
  if (!thread.archived && threadTreeIsWorking(thread)) return "working";
  if (
    !thread.archived
    && thread.status !== "error"
    && thread.queuedWork !== "failed"
    && threadTreeHasScheduledWork(thread)
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
