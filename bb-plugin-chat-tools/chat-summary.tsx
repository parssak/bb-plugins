import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contract";

const DISMISS_CHAT_SUMMARY_EVENT = "threadflow:dismiss-chat-summary";

const SUMMARIES_CHANGED_CHANNEL = "chat-summaries-changed";

const VIEWER_CLIENT_ID = `native-chat-${Math.random().toString(36).slice(2)}`;

const MESSAGE_BUBBLE_TAIL_PATH =
  "M8.33594 0.5C8.7668 0.821894 9.07248 1.04615 9.30176 1.21094C9.55938 1.3961 9.70552 1.49813 9.8252 1.58789C9.97196 1.69798 10.063 1.78007 10.2666 1.97949C9.91758 2.45087 9.86145 3.11747 9.9082 3.72559C9.97604 4.60748 10.2761 5.65946 10.6572 6.67578C11.041 7.69919 11.519 8.71995 11.9658 9.5498C12.3707 10.3016 12.7783 10.9463 13.0811 11.2812C13.1997 11.5187 13.2999 11.7209 13.3594 11.9004C13.3992 12.0208 13.4042 12.0854 13.4043 12.1133C13.3726 12.1293 13.2986 12.1562 13.1455 12.1699C12.8453 12.1969 12.3568 12.1616 11.5977 12.0098C9.22996 11.5361 7.06273 9.98557 5.25586 8.49023C4.3835 7.76828 3.54044 7.01048 2.88281 6.48438C2.54469 6.21388 2.22287 5.97683 1.92773 5.80566C1.64508 5.64174 1.32344 5.5 1 5.5H0.5V0.5H8.33594Z";

type ChatSummaryData = {
  threadId: string;
  sourceUpdatedAt: number;
  lastUserMessage: string;
  summary: string;
  followUps?: string[];
  dismissed: boolean;
};

export function NativeChatSummary({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const anchorRef = useRef<HTMLDivElement>(null);
  const followUpButtonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const viewerIdRef = useRef(
    `${VIEWER_CLIENT_ID}-${Math.random().toString(36).slice(2)}`,
  );
  const [summary, setSummary] = useState<ChatSummaryData | null>(null);
  const [selectedFollowUp, setSelectedFollowUp] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (showExisting = false) => {
      try {
        const result = await rpc.call("chat_summary", { threadId });
        setSummary(
          result.summary === null || !showExisting
            ? result.summary
            : { ...result.summary, dismissed: false },
        );
      } catch {
        setSummary(null);
      }
    },
    [rpc, threadId],
  );

  useEffect(() => {
    void load(true);
  }, [load]);
  useRealtime(SUMMARIES_CHANGED_CHANNEL, (event) => {
    if (
      typeof event === "object" &&
      event !== null &&
      (event as { threadId?: unknown }).threadId === threadId
    )
      void load();
  });
  useEffect(() => {
    const clientId = viewerIdRef.current;
    void rpc.call("set_viewing_thread", { clientId, threadId });
    return () => {
      void rpc.call("set_viewing_thread", { clientId, threadId: null });
    };
  }, [rpc, threadId]);
  useEffect(() => {
    setSelectedFollowUp(0);
    setError(null);
  }, [summary?.sourceUpdatedAt, threadId]);

  const setDismissed = useCallback(
    (dismissed: boolean) => {
      setSummary((current) =>
        current === null ? null : { ...current, dismissed },
      );
      void rpc.call("set_chat_summary_dismissed", { threadId, dismissed });
    },
    [rpc, threadId],
  );

  useEffect(() => {
    const dismiss = (event: Event) => {
      if ((event as CustomEvent<unknown>).detail === threadId)
        setDismissed(true);
    };
    window.addEventListener(DISMISS_CHAT_SUMMARY_EVENT, dismiss);
    return () =>
      window.removeEventListener(DISMISS_CHAT_SUMMARY_EVENT, dismiss);
  }, [setDismissed, threadId]);

  const followUps = summary?.followUps ?? [];
  const sendFollowUp = useCallback(
    async (index = selectedFollowUp) => {
      const message = followUps[index];
      if (message === undefined || sending) return;
      setSending(true);
      setError(null);
      try {
        await rpc.call("send_message", { threadId, message });
        setSummary(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setSending(false);
      }
    },
    [followUps, rpc, selectedFollowUp, sending, threadId],
  );

  useEffect(() => {
    if (summary?.dismissed !== false || followUps.length === 0) return;
    const activeElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (
      activeElement !== null &&
      activeElement.closest("[data-threadflow-row]") !== null
    )
      return;
    const frame = window.requestAnimationFrame(() =>
      followUpButtonsRef.current[0]?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [followUps.length, summary?.dismissed, summary?.sourceUpdatedAt]);

  return (
    <div
      ref={anchorRef}
      className="relative"
      data-threadflow-summary-open={
        summary?.dismissed === false ? "true" : undefined
      }
      data-threadflow-summary-thread-id={threadId}
    >
      {summary?.dismissed === true ? (
        <div className="flex justify-end px-1 pb-1">
          <button
            type="button"
            onClick={() => setDismissed(false)}
            className="text-[10px] text-muted-foreground/30 hover:text-muted-foreground"
          >
            Show TL;DR
          </button>
        </div>
      ) : null}
      {summary?.dismissed === false ? (
        <div
          data-bb-plugin="threadflow"
          className="relative z-30 px-4 py-6 text-foreground"
          aria-label="Chat summary"
          onKeyDown={(event) => {
            if (
              event.metaKey ||
              event.ctrlKey ||
              event.altKey ||
              event.shiftKey ||
              !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
                event.key,
              ) ||
              followUps.length === 0
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            const direction =
              event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
            const next =
              (selectedFollowUp + direction + followUps.length) %
              followUps.length;
            setSelectedFollowUp(next);
            followUpButtonsRef.current[next]?.focus({ preventScroll: true });
          }}
        >
          <div className="flex flex-col gap-3">
            <button
              type="button"
              aria-label="Show full chat"
              title="Show full chat"
              onClick={() => setDismissed(true)}
              className="absolute right-2 top-2 rounded p-1 text-muted-foreground/40 hover:bg-muted hover:text-muted-foreground"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="none"
                className="size-3"
              >
                <path
                  d="m4 4 8 8m0-8-8 8"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <div className="flex justify-end pt-3" aria-label="Your message">
              <div className="relative max-w-[70%] rounded-2xl bg-[var(--surface-recessed-solid)] px-3 py-1.5">
                <div className="max-h-[30vh] overflow-y-auto">
                  <Markdown
                    content={summary.lastUserMessage}
                    className="text-sm font-normal leading-relaxed text-foreground [&_code]:!text-[1em]"
                  />
                </div>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 14 13"
                  fill="none"
                  className="pointer-events-none absolute -bottom-[7px] right-1 z-10 h-[13px] w-[14px] text-[var(--surface-recessed-solid)]"
                >
                  <path
                    d={MESSAGE_BUBBLE_TAIL_PATH}
                    fill="currentColor"
                    stroke="currentColor"
                  />
                </svg>
              </div>
            </div>
            <div className="pr-6">
              <Markdown
                content={summary.summary}
                className="text-sm font-normal leading-relaxed text-foreground [&_code]:!text-[1em]"
              />
            </div>
            {followUps.length > 0 ? (
              <div
                className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2"
                aria-label="Suggested follow-ups"
              >
                {followUps.map((followUp, index) => (
                  <button
                    type="button"
                    ref={(button) => {
                      followUpButtonsRef.current[index] = button;
                    }}
                    key={`${index}:${followUp}`}
                    tabIndex={selectedFollowUp === index ? 0 : -1}
                    disabled={sending}
                    onMouseEnter={() => setSelectedFollowUp(index)}
                    onFocus={() => setSelectedFollowUp(index)}
                    onClick={() => {
                      void sendFollowUp(index);
                    }}
                    className={
                      selectedFollowUp === index
                        ? "rounded-md bg-muted px-3 py-2 text-left text-sm text-foreground outline outline-2 outline-dotted outline-blue-500 outline-offset-2"
                        : "rounded-md bg-muted/40 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    }
                  >
                    {followUp}
                  </button>
                ))}
              </div>
            ) : null}
            {error === null ? null : (
              <p className="text-xs text-destructive">{error}</p>
            )}
            <p className="text-[10px] text-muted-foreground/40">
              {sending ? "Sending…" : "↑/↓ to choose · Enter to send"}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
