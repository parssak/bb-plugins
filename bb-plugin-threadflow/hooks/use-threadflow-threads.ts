import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { NativeThread, rpcContract } from "../server";

type Scope = "recent" | "all";
type Snapshot = { threads: NativeThread[]; error: string | null };

function createStore() {
  let snapshot: Snapshot = { threads: [], error: null };
  let pending: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let consumers = 0;
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh(load: () => Promise<{ threads: NativeThread[] }>) {
      if (pending !== null) return pending;
      pending = load().then(
        ({ threads }) => publish({ threads, error: null }),
        (cause: unknown) => publish({ ...snapshot, error: cause instanceof Error ? cause.message : String(cause) }),
      ).finally(() => { pending = null; });
      return pending;
    },
    retain(refresh: () => Promise<void>) {
      if (consumers++ === 0) {
        void refresh();
        timer = setInterval(() => void refresh(), 30_000);
      }
      return () => {
        if (--consumers === 0) clearInterval(timer);
      };
    },
  };
}

// Navigation and list slots share one snapshot and one polling lifecycle.
const stores = { recent: createStore(), all: createStore() };

export function useThreadflowThreads(scope: Scope) {
  const rpc = useRpc<typeof rpcContract>();
  const store = stores[scope];
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const refresh = useCallback(
    () => store.refresh(() => rpc.call("threads", { scope, query: "" })),
    [rpc, scope, store],
  );
  useEffect(() => store.retain(refresh), [refresh, store]);
  useRealtime("threads-changed", () => { void refresh(); });
  return { ...snapshot, refresh };
}
