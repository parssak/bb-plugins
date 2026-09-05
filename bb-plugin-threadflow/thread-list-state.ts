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
