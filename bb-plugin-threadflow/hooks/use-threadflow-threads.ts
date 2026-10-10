import { useCallback, useEffect, useMemo, useState } from "react";
import {
  experimental_useSidebarThreads,
  experimental_useProviders,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { NativeThread, rpcContract } from "../contract";
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
  const refresh = useCallback(async () => {
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
  useEffect(() => {
    if (scope === "recent") void refresh();
  }, [refresh, scope, connection]);
  useRealtime("threads-changed", () => {
    if (scope === "recent") void refresh();
  });
  const threads = useMemo<NativeThread[]>(() => {
    const projects = new Map(native.projects.map((p) => [p.id, p.name]));
    const providerNames = new Map(providers.map((p) => [p.id, p.displayName]));
    const children = new Map<string, NativeThread["sideChats"]>();
    for (const thread of native.threads) {
      if (!thread.parentThreadId || thread.isArchived) continue;
      const list = children.get(thread.parentThreadId) ?? [];
      const owned =
        thread.isHidden &&
        thread.originKind === "fork" &&
        ["threadflow", "chat-tools"].includes(thread.originPluginId ?? "");
      list.push({
        id: thread.id,
        title: thread.displayTitle || thread.title || "Side chat",
        sourceThreadId: thread.parentThreadId,
        createdAt: thread.createdAt,
        needsAttention: thread.hasPendingInteraction,
        running: !["idle", "error"].includes(thread.runtimeStatus),
        closeable: owned,
        navigation: owned ? "thread" : "split",
      });
      children.set(thread.parentThreadId, list);
    }
    return native.threads
      .filter((t) => !t.parentThreadId && !t.isHidden)
      .map((t) => ({
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
        scheduledSendAt:
          t.status === "idle" &&
          !t.hasPendingInteraction &&
          t.queuedWork === "waiting"
            ? (scheduledSends[t.id] ?? null)
            : null,
        waitingForThreadIds: dependencies[t.id] ?? [],
        status: t.runtimeStatus,
        sideChats:
          children.get(t.id)?.sort((a, b) => a.createdAt - b.createdAt) ?? [],
      }));
  }, [
    native.threads,
    native.projects,
    providers,
    dependencies,
    scheduledSends,
  ]);
  return {
    threads,
    error: native.status === "error" ? "Couldn’t load threads" : null,
    refresh,
    archive: native.experimental_archived,
  };
}
