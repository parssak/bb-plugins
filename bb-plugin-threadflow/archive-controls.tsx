import { useEffect, useRef, useState } from "react";
import { useRpc, useSidebarSplitLayout } from "@get-bb/plugin-sdk/app";
import { HugeiconsIcon } from "@hugeicons/react";
import { Archive03Icon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import type { rpcContract } from "./contract";

export function ArchiveShortcut({
  activeThreadId,
}: {
  activeThreadId: string | null;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const splitLayout = useSidebarSplitLayout();
  const pending = useRef(false);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !event.metaKey ||
        !event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.key.toLowerCase() !== "a"
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="dialog"], [role="menu"]')) return;
      const focusedRow = target?.closest<HTMLElement>("[data-threadflow-row]");
      const focusedPane = splitLayout?.panes.find((pane) => pane.isFocused);
      const threadId =
        focusedRow?.dataset.threadId ??
        (focusedPane ? focusedPane.threadId : activeThreadId);
      if (!threadId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || pending.current) return;
      pending.current = true;
      void rpc
        .call("toggle_archived", { id: threadId })
        .catch((cause) =>
          toast.error(cause instanceof Error ? cause.message : String(cause)),
        )
        .finally(() => {
          pending.current = false;
        });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeThreadId, rpc, splitLayout]);
  return null;
}

export function ArchiveThreadButton({
  threadId,
  title,
}: {
  threadId: string;
  title: string;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  return (
    <button
      type="button"
      aria-label={`Archive ${title}`}
      title="Archive thread (⌘⇧A)"
      disabled={pending}
      className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-muted-foreground/40 disabled:opacity-50 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
      onClick={(event) => {
        event.stopPropagation();
        if (inFlight.current) return;
        inFlight.current = true;
        setPending(true);
        void rpc
          .call("toggle_archived", { id: threadId })
          .catch((cause) =>
            toast.error(cause instanceof Error ? cause.message : String(cause)),
          )
          .finally(() => {
            inFlight.current = false;
            setPending(false);
          });
      }}
    >
      <HugeiconsIcon icon={Archive03Icon} className="size-3.5" aria-hidden />
    </button>
  );
}
