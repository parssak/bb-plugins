import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
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

export function ThreadNudgerToggle() {
  const rpc = useRpc<typeof rpcContract>();
  const view = useComposerView();
  const connectionState = useRealtimeConnectionState();
  const threadId = view.scope.kind === "thread" ? view.scope.threadId : null;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const [footerSlot, setFooterSlot] = useState<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !threadId || !view.run.isRunning || view.layout === "compact") {
      setFooterSlot(null);
      return;
    }

    const composer = anchor.closest("[data-follow-up-composer]");
    const footer = composer?.querySelector("[data-follow-up-composer-footer]");
    const controls = footer?.lastElementChild;
    if (!(controls instanceof HTMLElement)) {
      setFooterSlot(null);
      return;
    }

    const contextControl = Array.from(controls.children).find(
      (child) =>
        child.matches('[aria-label^="Context window"]') ||
        child.querySelector('[aria-label^="Context window"]'),
    );
    const slot = document.createElement("span");
    slot.className = "thread-nudger-footer-slot";
    controls.insertBefore(slot, contextControl ?? null);
    setFooterSlot(slot);

    return () => {
      slot.remove();
    };
  }, [anchor, threadId, view.layout, view.run.isRunning]);

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
    <>
      <span ref={setAnchor} className="thread-nudger-anchor" />
      {footerSlot
        ? createPortal(
            <button
              aria-checked={enabled ?? undefined}
              aria-label={title}
              className="thread-nudger-toggle"
              data-enabled={enabled === true ? "true" : "false"}
              disabled={enabled === null || saving || failed}
              onClick={() => void toggle()}
              role="switch"
              title={title}
              type="button"
            >
              <span aria-hidden="true" className="thread-nudger-switch-track">
                <span className="thread-nudger-switch-thumb" />
              </span>
            </button>,
            footerSlot,
          )
        : null}
    </>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "thread-nudger-toggle",
    scopes: ["thread"],
    actions: [{ id: "toggle", component: ThreadNudgerToggle }],
  });
});
