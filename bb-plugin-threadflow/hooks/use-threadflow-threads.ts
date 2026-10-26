import { useCallback, useEffect, useMemo, useState } from "react";
import {
  experimental_useSidebarThreads,
  experimental_useProviders,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type {
  HiddenChildThread,
  NativeChildThread,
  NativeThread,
  rpcContract,
} from "../contract";
import { threadIsRunning } from "../thread-list-state";

/** Background agent counts change without a thread event, so poll while they run. */
const HIDDEN_CHILD_POLL_MS = 15_000;

const SIDE_CHAT_PLUGIN_IDS = ["threadflow", "chat-tools"];

type ChildThreadSource = Omit<NativeChildThread, "children">;

function childScheduledSendAt(
  children: readonly NativeChildThread[],
  scheduledSends: Readonly<Record<string, number>>,
): number | null {
  const sendAts = children.flatMap((child) => [
    child.status === "idle" &&
    !child.needsAttention &&
    child.queuedWork === "waiting"
      ? (scheduledSends[child.id] ?? null)
      : null,
    childScheduledSendAt(child.children, scheduledSends),
  ]);
  const scheduled = sendAts.filter((sendAt) => sendAt !== null);
  return scheduled.length === 0 ? null : Math.min(...scheduled);
}

function isOwnedSideChat(thread: {
  originKind: "fork" | null;
  originPluginId: string | null;
}): boolean {
  return (
    thread.originKind === "fork" &&
    SIDE_CHAT_PLUGIN_IDS.includes(thread.originPluginId ?? "")
  );
}

export function useThreadflowThreads(scope: "recent" | "all") {
  const native = experimental_useSidebarThreads({
    experimental_lifecycles: scope === "all" ? ["archived"] : ["active"],
  });
  const { providers } = experimental_useProviders();
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [dependencies, setDependencies] = useState<Record<string, string[]>>(
    {},
  );
  const [scheduledSends, setScheduledSends] = useState<Record<string, number>>(
    {},
  );
  const [hiddenChildren, setHiddenChildren] = useState<
    readonly HiddenChildThread[]
  >([]);
  const refreshWaits = useCallback(async () => {
    try {
      const result = await rpc.call("wait_dependencies", {});
      setScheduledSends(
        Object.fromEntries(
          [...result.scheduledSends]
            .sort((a, b) => b.sendAt - a.sendAt)
            .map((s) => [s.threadId, s.sendAt]),
        ),
      );
      setDependencies(
        Object.fromEntries(
          result.dependencies.map((d) => [
            d.waitingThreadId,
            d.targetThreadIds,
          ]),
        ),
      );
    } catch {
      /* Preserve the last dependency snapshot while reconnecting. */
    }
  }, [rpc]);
  const refreshHiddenChildren = useCallback(async () => {
    try {
      const result = await rpc.call("hidden_child_threads", {});
      setHiddenChildren(result.threads);
    } catch {
      /* Preserve the last child snapshot while reconnecting. */
    }
  }, [rpc]);
  const refresh = useCallback(async () => {
    await Promise.all([refreshWaits(), refreshHiddenChildren()]);
  }, [refreshHiddenChildren, refreshWaits]);
  useEffect(() => {
    if (scope === "recent") void refresh();
  }, [refresh, scope, connection]);
  useRealtime("threads-changed", () => {
    if (scope === "recent") void refresh();
  });
  const hiddenChildWorkRunning = hiddenChildren.some(threadIsRunning);
  useEffect(() => {
    if (scope !== "recent" || !hiddenChildWorkRunning) return;
    const timer = window.setInterval(
      () => void refreshHiddenChildren(),
      HIDDEN_CHILD_POLL_MS,
    );
    return () => window.clearInterval(timer);
  }, [hiddenChildWorkRunning, refreshHiddenChildren, scope]);
  const threads = useMemo<NativeThread[]>(() => {
    const projects = new Map(native.projects.map((p) => [p.id, p.name]));
    const providerNames = new Map(providers.map((p) => [p.id, p.displayName]));
    const childSources = new Map<string, ChildThreadSource>();
    for (const thread of native.threads) {
      if (!thread.parentThreadId || thread.isArchived) continue;
      const owned = thread.isHidden && isOwnedSideChat(thread);
      childSources.set(thread.id, {
        id: thread.id,
        title: thread.displayTitle || thread.title || "Side chat",
        parentThreadId: thread.parentThreadId,
        createdAt: thread.createdAt,
        status: thread.runtimeStatus,
        needsAttention: thread.hasPendingInteraction,
        backgroundWork:
          thread.activity.backgroundAgents + thread.activity.workflows,
        queuedWork: thread.queuedWork,
        closeable: thread.isHidden && thread.originKind === "fork",
        navigation: owned ? "thread" : "split",
      });
    }
    for (const thread of hiddenChildren) {
      if (childSources.has(thread.id)) continue;
      const owned = isOwnedSideChat(thread);
      childSources.set(thread.id, {
        id: thread.id,
        title: thread.title,
        parentThreadId: thread.parentThreadId,
        createdAt: thread.createdAt,
        status: thread.status,
        needsAttention: thread.needsAttention,
        backgroundWork: thread.backgroundWork,
        queuedWork: thread.queuedWork,
        // Any hidden fork can be closed, including BB's own side chats that
        // were opened by accident and never used.
        closeable: thread.originKind === "fork",
        navigation: owned ? "thread" : "split",
      });
    }
    const childrenByParentId = new Map<string, ChildThreadSource[]>();
    for (const child of childSources.values()) {
      const siblings = childrenByParentId.get(child.parentThreadId) ?? [];
      siblings.push(child);
      childrenByParentId.set(child.parentThreadId, siblings);
    }
    const buildChildren = (
      parentThreadId: string,
      visited: Set<string>,
    ): NativeChildThread[] =>
      (childrenByParentId.get(parentThreadId) ?? [])
        .filter((child) => !visited.has(child.id))
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((child) => {
          visited.add(child.id);
          return { ...child, children: buildChildren(child.id, visited) };
        });
    return native.threads
      .filter((t) => !t.parentThreadId && !t.isHidden)
      .map((t) => {
        const children = buildChildren(t.id, new Set([t.id]));
        const idle = t.status === "idle" && !t.hasPendingInteraction;
        return {
          id: t.id,
          title: t.displayTitle || t.title || "Untitled",
          projectId: t.projectId,
          project: projects.get(t.projectId) ?? "Personal",
          provider: providerNames.get(t.providerId) ?? t.providerId,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          archivedAt: t.archivedAt,
          archived: t.isArchived,
          needsAttention: t.hasPendingInteraction,
          queuedWork: t.queuedWork,
          // A parent snoozed by a review's send-later shows when that send fires.
          scheduledSendAt: !idle
            ? null
            : t.queuedWork === "waiting"
              ? (scheduledSends[t.id] ?? null)
              : t.queuedWork === "none"
                ? childScheduledSendAt(children, scheduledSends)
                : null,
          waitingForThreadIds: dependencies[t.id] ?? [],
          status: t.runtimeStatus,
          backgroundWork: t.activity.backgroundAgents + t.activity.workflows,
          children,
        };
      });
  }, [
    native.threads,
    native.projects,
    providers,
    dependencies,
    scheduledSends,
    hiddenChildren,
  ]);
  return {
    threads,
    error: native.status === "error" ? "Couldn’t load threads" : null,
    refresh,
    archive: native.experimental_archived,
  };
}
