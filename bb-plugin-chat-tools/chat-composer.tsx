import { NativeChatSummary } from "./chat-summary";
import {
  replaceNativeUserMessageTimestamps,
  clearNativeUserMessageTimestamps,
  NATIVE_USER_MESSAGE_SELECTOR,
} from "./chat-decoration";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useSdk,
  useBbNavigate,
  useComposer,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contract";
import { toast } from "sonner";
import { isCaretAtTextEnd } from "./prompt-autocomplete";

const THREADS_CHANGED_CHANNEL = "threads-changed";

const REVIEW_WORKTREE_PROMPT = "Review the changes in this worktree";

function useThreadCommand(threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const sdk = useSdk();
  const actions = useMemo(
    () => ({
      open: (id: string, options?: { split?: boolean }) =>
        navigate.toThread(id, options),
      rename: (id: string, title: string) =>
        sdk.threads.update({ threadId: id, title }),
    }),
    [navigate, sdk],
  );

  return useCallback(
    async (key: string, shiftKey: boolean) => {
      if (threadId === null) return false;
      if (shiftKey && key === "e") {
        const result = await rpc.call("create_side_chat", {
          sourceThreadId: threadId,
          initialMessage: REVIEW_WORKTREE_PROMPT,
          title: "Review",
        });
        const opened = navigate.openThreadPanel({
          actionId: "side-chat",
          title: "Review",
          params: { childThreadId: result.thread.id },
        });
        if (!opened) actions.open(result.thread.id);
        return true;
      }
      if (shiftKey && key === "t") {
        const result = await rpc.call("toggle_chat_summary", { threadId });
        if (result.status === "started") toast.success("Generating TLDR…");
        else if (result.status === "busy")
          toast.success("TLDR is already generating");
        return true;
      }
      if (shiftKey && key === "a") {
        await rpc.call("toggle_archived", { id: threadId });
        return true;
      }
      return false;
    },
    [actions, navigate, rpc, threadId],
  );
}

function PromptAutocomplete() {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const view = composer;
  const anchorRef = useRef<HTMLDivElement>(null);
  const previousDraftRef = useRef(view.text);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void rpc.call("prompt_history", {}).then(
      ({ prompts }) => {
        if (!cancelled) setHistory(prompts);
      },
      () => {
        // Autocomplete is optional; the composer remains native on failure.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  useEffect(() => {
    const previous = previousDraftRef.current.trim();
    previousDraftRef.current = view.text;
    if (previous === "" || !view.isEmpty) return;
    setHistory((current) =>
      [
        previous,
        ...current.filter(
          (prompt) =>
            prompt.toLocaleLowerCase() !== previous.toLocaleLowerCase(),
        ),
      ].slice(0, 100),
    );
  }, [view.isEmpty, view.text]);

  const typed = view.text;
  const normalizedTyped = typed.toLocaleLowerCase();
  const suggestion =
    typed === "" || typed.includes("\n")
      ? null
      : (history.find(
          (prompt) =>
            prompt.length > typed.length &&
            prompt.toLocaleLowerCase().startsWith(normalizedTyped),
        ) ?? null);
  const accept = useCallback(() => {
    if (suggestion === null) return;
    composer.replace({ text: suggestion, mentions: [] });
    composer.focus();
  }, [composer, suggestion]);

  useEffect(() => {
    if (suggestion === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
        return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editor =
        target?.closest<HTMLElement>(
          "input, textarea, [contenteditable='true']",
        ) ?? null;
      if (
        editor === null ||
        (event.key !== "Tab" &&
          (event.key !== "ArrowRight" || !isCaretAtTextEnd(editor)))
      )
        return;
      const anchorRect = anchorRef.current?.getBoundingClientRect();
      const targetRect = editor.getBoundingClientRect();
      if (
        anchorRect === undefined ||
        targetRect.right < anchorRect.left ||
        targetRect.left > anchorRect.right
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      accept();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [accept, suggestion]);

  return (
    <div
      ref={anchorRef}
      data-bb-plugin="threadflow"
      className="relative h-0 w-full max-w-full min-w-0"
    >
      {suggestion === null ? null : (
        <div className="pointer-events-none absolute inset-x-0 bottom-1 z-20 flex items-center gap-2 overflow-hidden px-3 text-xs">
          <button
            type="button"
            onClick={accept}
            className="pointer-events-auto w-0 min-w-0 flex-1 overflow-hidden text-left text-muted-foreground/50 hover:text-muted-foreground"
          >
            <span className="block truncate">
              <span className="text-muted-foreground/80">{typed}</span>
              {suggestion.slice(typed.length)}
            </span>
          </button>
          <kbd className="ml-auto shrink-0 rounded border border-border px-1 py-0.5 font-mono text-[9px] text-muted-foreground/50">
            Tab / →
          </kbd>
        </div>
      )}
    </div>
  );
}

function NewThreadComposerBridge() {
  useEffect(() => {
    document.documentElement.dataset.threadflowComposerScope = "new-thread";
    return () => {
      if (
        document.documentElement.dataset.threadflowComposerScope ===
        "new-thread"
      ) {
        delete document.documentElement.dataset.threadflowComposerScope;
      }
    };
  }, []);
  return <PromptAutocomplete />;
}

function NativeUserMessageTimestampBridge({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const refresh = useCallback(async () => {
    try {
      const result = await rpc.call("user_message_timestamps", { threadId });
      replaceNativeUserMessageTimestamps(threadId, result.messages);
    } catch {
      // Keep the last successful mapping through transient host or plugin reloads.
    }
  }, [rpc, threadId]);

  useEffect(() => {
    void refresh();
    return () => clearNativeUserMessageTimestamps(threadId);
  }, [refresh, threadId]);
  useEffect(() => {
    let timer: number | null = null;
    const observer = new MutationObserver((records) => {
      const addedUserMessage = records.some((record) =>
        Array.from(record.addedNodes).some(
          (node) =>
            node instanceof Element &&
            (node.matches(NATIVE_USER_MESSAGE_SELECTOR) ||
              node.querySelector(NATIVE_USER_MESSAGE_SELECTOR) !== null),
        ),
      );
      if (!addedUserMessage) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void refresh();
      }, 50);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [refresh]);
  useRealtime(THREADS_CHANGED_CHANNEL, () => void refresh());
  return null;
}

function ThreadComposerBridge({ threadId }: { threadId: string }) {
  const bridgeRef = useRef<HTMLDivElement>(null);
  const runThreadCommand = useThreadCommand(threadId);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || !event.shiftKey || event.ctrlKey || event.altKey)
        return;
      const key = event.key.toLowerCase();
      if (!["e", "t"].includes(key)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="dialog"],[data-threadflow-row]')) return;
      const rect = bridgeRef.current?.getBoundingClientRect();
      if (rect && target) {
        const targetRect = target.getBoundingClientRect();
        if (targetRect.right < rect.left || targetRect.left > rect.right)
          return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      void runThreadCommand(key, true).catch((cause) =>
        toast.error(String(cause)),
      );
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [runThreadCommand]);
  return (
    <div ref={bridgeRef}>
      <NativeUserMessageTimestampBridge threadId={threadId} />
      <NativeChatSummary threadId={threadId} />
      <PromptAutocomplete />
    </div>
  );
}

export function ComposerBridge() {
  const composer = useComposer();
  if (composer.scope.kind === "new-thread") return <NewThreadComposerBridge />;
  if (composer.scope.kind === "thread")
    return <ThreadComposerBridge threadId={composer.scope.threadId} />;
  return null;
}
