import { useCallback, useEffect, useState } from "react";
import { ThreadChat, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contract";
import { toast } from "sonner";
import { Button } from "./components/ui/button";

const HANDOFFS_CHANGED_CHANNEL = "side-chat-handoffs-changed";

export function NativeSideChatPanel({
  threadId: sourceThreadId,
  params,
}: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const requestedThreadId =
    typeof params === "object" &&
    params !== null &&
    !Array.isArray(params) &&
    typeof params.childThreadId === "string"
      ? params.childThreadId
      : null;
  const [threadId, setThreadId] = useState<string | null>(requestedThreadId);
  const [error, setError] = useState<string | null>(null);
  const [handoffPending, setHandoffPending] = useState(false);

  useEffect(() => {
    setThreadId(requestedThreadId);
    setError(null);
    if (requestedThreadId !== null) return;
    let cancelled = false;
    void rpc
      .call("create_side_chat", { sourceThreadId })
      .then((result) => {
        if (!cancelled) setThreadId(result.thread.id);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [requestedThreadId, rpc, sourceThreadId]);

  useEffect(() => {
    if (threadId === null) {
      setHandoffPending(false);
      return;
    }
    let cancelled = false;
    void rpc.call("handoff_status", { threadId }).then(
      ({ pending }) => {
        if (!cancelled) setHandoffPending(pending);
      },
      () => {
        if (!cancelled) setHandoffPending(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId]);

  useRealtime(HANDOFFS_CHANGED_CHANNEL, (event) => {
    if (typeof event !== "object" || event === null || threadId === null)
      return;
    const update = event as {
      threadId?: unknown;
      status?: unknown;
      message?: unknown;
    };
    if (
      update.threadId !== threadId ||
      (update.status !== "sent" && update.status !== "failed")
    )
      return;
    setHandoffPending(false);
    if (update.status === "sent")
      toast.success("Handoff sent to the main agent");
    else
      toast.error(
        typeof update.message === "string" ? update.message : "Handoff failed",
      );
  });

  const requestHandoff = useCallback(async () => {
    if (threadId === null || handoffPending) return;
    setHandoffPending(true);
    try {
      await rpc.call("handoff_side_chat", { threadId });
      toast.success("Handoff requested");
    } catch (cause) {
      setHandoffPending(false);
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  }, [handoffPending, rpc, threadId]);

  if (error !== null)
    return <div className="p-4 text-sm text-destructive">{error}</div>;
  if (threadId === null)
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Starting side chat…
      </div>
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 justify-end border-b border-border/50 px-2 py-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={handoffPending}
          onClick={() => void requestHandoff()}
        >
          {handoffPending ? "Handing off…" : "Handoff"}
        </Button>
      </div>
      <ThreadChat
        threadId={threadId}
        variant="compact"
        layout="contained"
        permissionPolicy="editable"
        className="min-h-0 flex-1"
      />
    </div>
  );
}
