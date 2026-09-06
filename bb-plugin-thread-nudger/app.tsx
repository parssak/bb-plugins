import { useEffect, useState } from "react";
import {
  definePluginApp,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import "./app.css";

type NudgingChanged = {
  threadId: string;
  enabled: boolean;
};

function isNudgingChanged(value: unknown): value is NudgingChanged {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return typeof event.threadId === "string" && typeof event.enabled === "boolean";
}

function BellIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
      <path
        d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      {!enabled && (
        <path
          d="m4 4 16 16"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

export function ThreadNudgerToggle() {
  const rpc = useRpc<typeof rpcContract>();
  const view = useComposerView();
  const connectionState = useRealtimeConnectionState();
  const threadId = view.scope.kind === "thread" ? view.scope.threadId : null;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!threadId || !view.run.isRunning || connectionState !== "connected") return;
    let cancelled = false;
    setEnabled(null);
    setFailed(false);
    void rpc.call("getThreadNudging", { threadId }).then(
      (result) => {
        if (!cancelled) setEnabled(result.enabled);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [connectionState, rpc, threadId, view.run.isRunning]);

  useRealtime("nudging-changed", (payload) => {
    if (isNudgingChanged(payload) && payload.threadId === threadId) {
      setEnabled(payload.enabled);
      setFailed(false);
    }
  });

  if (!threadId || !view.run.isRunning) return null;

  const title = failed
    ? "Thread nudging unavailable"
    : enabled === null
      ? "Checking thread nudging…"
      : enabled
        ? "Thread nudging is on — click to turn it off"
        : "Thread nudging is off — click to turn it on";

  async function toggle() {
    if (!threadId || enabled === null || saving) return;
    const nextEnabled = !enabled;
    setEnabled(nextEnabled);
    setSaving(true);
    setFailed(false);
    try {
      const result = await rpc.call("setThreadNudging", {
        threadId,
        enabled: nextEnabled,
      });
      setEnabled(result.enabled);
    } catch {
      setEnabled(enabled);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      aria-label={title}
      aria-pressed={enabled ?? false}
      className="thread-nudger-toggle"
      data-enabled={enabled === true ? "true" : "false"}
      disabled={enabled === null || saving || failed}
      onClick={() => void toggle()}
      title={title}
      type="button"
    >
      <BellIcon enabled={enabled !== false} />
    </button>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "thread-nudger-toggle",
    scopes: ["thread"],
    actions: [{ id: "toggle", component: ThreadNudgerToggle }],
  });
});
