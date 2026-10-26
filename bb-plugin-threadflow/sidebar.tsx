import { z } from "zod";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  ArchiveRestoreIcon,
} from "@hugeicons/core-free-icons";
import {
  UrlLink,
  experimental_useSidebarThreads,
  useSdk,
  experimental_useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type {
  PluginSidebarPullRequest,
  PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import type {
  NativeChildThread,
  NativeThread,
  rpcContract,
} from "./contract";
import { useThreadflowThreads } from "./hooks/use-threadflow-threads";
import { ArchiveThreadButton } from "./archive-controls";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import {
  parseThreadTitleBrand,
  type ThreadTitleBrand,
} from "./thread-title-brand";
import {
  classifyThreadListState,
  nestWorkingThreadDependencies,
  threadTreeIsWorking,
  threadTreeNeedsAttention,
} from "./thread-list-state";
import { formatJournalDayGroup } from "./journal-date";
import {
  serializeThreadReferenceDrag,
  THREAD_REFERENCE_DRAG_TYPE,
  threadReferenceMarkdown,
} from "./thread-reference";

type TypeInChatDetail = {
  threadId: string;
  text: string;
  /** Set by the composer that accepted the keystroke. */
  handled?: boolean;
};

const TYPE_IN_CHAT_EVENT = "threadflow:type-in-chat";

const RETURN_TO_SIDEBAR_EVENT = "threadflow:return-to-sidebar";

const KEYBOARD_FOCUS_MODE_EVENT = "threadflow:keyboard-focus-mode";

const DISMISS_CHAT_SUMMARY_EVENT = "threadflow:dismiss-chat-summary";

const REVIEW_WORKTREE_PROMPT = "Review the changes in this worktree";

const WAITING_COLLAPSED_STORAGE_KEY = "threadflow:waiting-collapsed:v1";

const SIDEBAR_LABEL_CASE_STORAGE_KEY = "threadflow:sidebar-label-case:v1";

type SidebarLabelCase = "lower" | "capital" | "upper";

type SidebarMode = "threads" | "history";

let sidebarMode: SidebarMode = "threads";

const sidebarModeListeners = new Set<() => void>();

function formatSidebarLabel(
  label: string,
  labelCase: SidebarLabelCase,
): string {
  const lower = (label === "Waiting" ? "Snoozed" : label).toLowerCase();
  if (labelCase === "upper") return lower.toUpperCase();
  if (labelCase === "capital")
    return lower.replace(/^./, (character) => character.toUpperCase());
  return lower;
}

function nextSidebarLabelCase(labelCase: SidebarLabelCase): SidebarLabelCase {
  if (labelCase === "lower") return "capital";
  if (labelCase === "capital") return "upper";
  return "lower";
}

function setSidebarMode(mode: SidebarMode) {
  if (sidebarMode === mode) return;
  sidebarMode = mode;
  for (const listener of sidebarModeListeners) listener();
}

function subscribeSidebarMode(listener: () => void) {
  sidebarModeListeners.add(listener);
  return () => sidebarModeListeners.delete(listener);
}

function useSidebarMode(): SidebarMode {
  return useSyncExternalStore(
    subscribeSidebarMode,
    () => sidebarMode,
    () => "threads",
  );
}

const BB_LOGO_DATA_URL =
  "data:image/webp;base64," +
  "UklGRqwDAABXRUJQVlA4TKADAAAvL8ALEJUGQbbN66+9nCEiJmANn1izbSRJUf5Rt3OzR/9vHz1TBKMAYJQc7pJB+0CbNVkBnhTY" +
  "E9cW64CDI7eNHImeueWwrn2DbEmyTdt6t7m5ONexbdu2bfuca9u2bdu2bdvWwlxx/8A6EhAU+T/aBPSfgdtGirzHDJ19RFm6oGDg4" +
  "BEQSo5yYlwR0MkoAJAKomFkZmVzUs66Qe0C/uMLgUXeYG7+wDxw69WLiJL9jsozDt9KfUfnspc67q/QRrX0J4WnWydqd5K0T5HBa" +
  "TyH+q2zvuIAm/sA3p5fAbd6zjBcMSCfpzC85zIneQFseBRo2GactlBYcA7aWxYYU5d24iUQoH6rxpZvmGS0doD5eh/aKbJ1x7QO" +
  "XAR2oHzDGJC6QzdDsBSxgg/QlpmIG0b6ehcICMOFQ6MOkocHhoidDuOew4zQEWCp74GgOV14jGo2oVoNGcUJaLdXgY/mYkyjBYK" +
  "xuAiYde9a7CWnPkeWO2K1VtF3I4jARmL6O+5HWrgXmQ8XIas4S4DUkJloP/P91JryZDTHHoD6PNnHZGpWSCfmcQU2VkLBJhaij4n" +
  "BBumkCfgFU73yzADqXDRTTKYz4chZ6GM+q/cWJjavD1RivUJzibr3Q5a3bC3UGECkLmCCaSocMTM9iVqiaVsrX3eIWJ4NFpnueK/" +
  "ylnecJQoBRtMX3Q9Ds+hLZ1JINMmI5XEfnnYRQ9GKLWQNjL9eBo6RQNTw7eQNH/mzlWxi9MON3fI0iTATjN1IGD/iIQFQUOILhpG" +
  "qlzTpr71GWwo/T8jVbe76cZQW2mHMwMQ1dC0fob2jM7bqi7IYFsiFTuCiqYaG+BCGCUhEhi6B5zA8IxWgSKnbYV0IkpN1GgH2Lc" +
  "AO2j1C+IOPoAcfYTiAOYKpaLWbsHICyeEaKZAJZ7zjtLS0vKQrqOSMQOwCM2oFaKo6WWtg5xCS86OYTIDOtJbKMW6xnyoNMZglHf" +
  "IL2EO+eEBnRKhMbnoch51zSB29IHVaEyhEMjsCcMQMG11xUlN5kVWzk8PMIwlEjSmq+Ulw1BGsTvfpqHgYFIZazF53fOqLjgpKZ4" +
  "Yn4QRpC0CMuqIN9C0cdertgf1maTtzbOaoB+E0soGK6WqJDxGE8tcSEsmcN5d3cPQDAT3znH3MYDijWZRTvKblBYsoI4VYgnDV2S" +
  "iGcQXOfsbssYA84ww72MAWTvIESD+WvifT93Dynk8/R5LPqeRzMPmcTT3H0/5PWLgU";

type KeyboardFocusMode = "sidebar" | "chat";

function getKeyboardFocusMode(): KeyboardFocusMode {
  return document.documentElement.dataset.threadflowFocusMode === "sidebar"
    ? "sidebar"
    : "chat";
}

function setKeyboardFocusMode(mode: KeyboardFocusMode) {
  if (getKeyboardFocusMode() === mode) return;
  document.documentElement.dataset.threadflowFocusMode = mode;
  window.dispatchEvent(
    new CustomEvent<KeyboardFocusMode>(KEYBOARD_FOCUS_MODE_EVENT, {
      detail: mode,
    }),
  );
}

function relativeTime(timestamp: number): string {
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - timestamp) / 60_000),
  );
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function elapsedTime(timestamp: number): string {
  const relative = relativeTime(timestamp);
  return relative === "just now" ? "now" : relative.replace(/ ago$/, "");
}

function futureTime(timestamp: number): string {
  const remainingMinutes = Math.max(
    0,
    Math.floor((timestamp - Date.now()) / 60_000),
  );
  if (remainingMinutes < 1) return "now";
  if (remainingMinutes < 60) return `in ${remainingMinutes}m`;
  const hours = Math.floor(remainingMinutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.floor(hours / 24)}d`;
}

function PullRequestLink({
  pullRequest,
}: {
  pullRequest: PluginSidebarPullRequest;
}) {
  return (
    <UrlLink
      href={pullRequest.url}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none hover:brightness-125 ${pullRequestColor(pullRequest.attention)}`}
      aria-label={`Open pull request ${pullRequest.number}: ${pullRequest.title}`}
      title={`Open PR #${pullRequest.number}: ${pullRequest.title}`}
    >
      <span>#{pullRequest.number}</span>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        className="size-3"
      >
        <path
          d="M6 4h6v6M12 4 5 11"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </UrlLink>
  );
}

function useThreadCommand(threadId: string | null) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  return useCallback(
    async (key: string, shiftKey: boolean) => {
      if (!threadId || !shiftKey) return false;
      if (key === "e") {
        const result = await sdk.plugins.callRpc({
          pluginId: "chat-tools",
          method: "create_side_chat",
          input: {
            sourceThreadId: threadId,
            title: "Review",
            initialMessage: REVIEW_WORKTREE_PROMPT,
          },
          outputSchema: z
            .object({ thread: z.object({ id: z.string() }).passthrough() })
            .passthrough(),
        });
        navigate.toThread(result.thread.id, { split: true });
        return true;
      }
      if (key === "t") {
        const result = await sdk.plugins.callRpc({
          pluginId: "chat-tools",
          method: "toggle_chat_summary",
          input: { threadId },
          outputSchema: z
            .object({ status: z.enum(["shown", "hidden", "started", "busy"]) })
            .strict(),
        });
        if (result.status === "started") toast.success("Generating TLDR…");
        return true;
      }
      return false;
    },
    [sdk, navigate, threadId],
  );
}

function pullRequestColor(attention: string): string {
  if (attention === "ready_to_merge")
    return "border-green-500/40 bg-green-500/10 text-green-500";
  if (
    ["blocked", "changes_requested", "checks_failed", "conflicts"].includes(
      attention,
    )
  ) {
    return "border-red-500/40 bg-red-500/10 text-red-500";
  }
  if (["checks_pending", "review_requested"].includes(attention)) {
    return "border-amber-500/40 bg-amber-500/10 text-amber-500";
  }
  if (attention === "merged")
    return "border-violet-500/40 bg-violet-500/10 text-violet-500";
  return "border-border bg-muted text-muted-foreground";
}

function PullRequestProbe({
  threadId,
  onChange,
}: {
  threadId: string;
  onChange: (
    threadId: string,
    pullRequest: PluginSidebarPullRequest | null,
  ) => void;
}) {
  const { isLoading, pullRequest } =
    experimental_useSidebarThreadPullRequest(threadId);
  useEffect(() => {
    if (!isLoading) onChange(threadId, pullRequest);
  }, [isLoading, onChange, pullRequest, threadId]);
  return null;
}

function groupSidebarThreads(
  threads: readonly NativeThread[],
  pullRequests: Readonly<Record<string, PluginSidebarPullRequest | null>>,
): {
  groups: Array<readonly [string, NativeThread[]]>;
  dependenciesByParentId: Map<string, NativeThread[]>;
} {
  const { topLevelThreads, dependenciesByParentId } =
    nestWorkingThreadDependencies(threads);
  const working: NativeThread[] = [];
  const waiting: NativeThread[] = [];
  const needsYou: NativeThread[] = [];
  const inReview: NativeThread[] = [];
  for (const thread of topLevelThreads) {
    const state = classifyThreadListState(thread);
    if (state === "working") {
      working.push(thread);
    } else if (state === "waiting") {
      waiting.push(thread);
    } else if (
      pullRequests[thread.id]?.state === "open" ||
      pullRequests[thread.id]?.state === "draft"
    ) {
      inReview.push(thread);
    } else {
      needsYou.push(thread);
    }
  }
  const groups: Array<readonly [string, NativeThread[]]> = [
    ["Needs you", needsYou],
  ];
  if (inReview.length > 0) groups.push(["In review", inReview]);
  groups.push(["Working", working]);
  if (waiting.length > 0) groups.push(["Waiting", waiting]);
  return { groups, dependenciesByParentId };
}

function BackgroundCommandIndicator({ count }: { count: number }) {
  if (count === 0) return null;
  const label = `${count} background ${count === 1 ? "command" : "commands"} running`;
  return (
    <span
      className="relative flex size-2 shrink-0"
      role="img"
      aria-label={label}
      title={label}
    >
      <span
        className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-50"
        aria-hidden="true"
      />
      <span
        className="relative inline-flex size-2 rounded-full bg-emerald-500"
        aria-hidden="true"
      />
    </span>
  );
}

function BackgroundWorkBadge({ count }: { count: number }) {
  if (count === 0) return null;
  const label = `${count} background ${count === 1 ? "agent" : "agents"} running`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="flex shrink-0 items-center gap-0.5 font-mono text-[9px] leading-none text-muted-foreground"
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-3">
        <rect
          x="3"
          y="5"
          width="10"
          height="8"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path
          d="M8 5V3M6 9h.01M10 9h.01"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      {count}
    </span>
  );
}

function ChildThreadStatus({ thread }: { thread: NativeChildThread }) {
  const status = threadTreeNeedsAttention(thread)
    ? "attention"
    : threadTreeIsWorking(thread)
      ? "working"
      : "idle";
  return (
    <span className="flex size-2.5 shrink-0 items-center justify-center">
      {status === "attention" ? (
        <span
          role="img"
          aria-label="Needs your input"
          title="Needs your input"
          className="size-1.5 rounded-full bg-amber-500"
        />
      ) : status === "working" ? (
        <span
          role="img"
          aria-label="Working"
          title="Working"
          className="size-2.5 animate-spin rounded-full border border-muted-foreground/30 border-t-foreground"
        />
      ) : null}
    </span>
  );
}

function flattenChildThreads(
  threads: readonly NativeChildThread[],
): NativeChildThread[] {
  return threads.flatMap((thread) => [
    thread,
    ...flattenChildThreads(thread.children),
  ]);
}

function ChildThreadRows({
  threads,
  selectedThreadId,
  onOpen,
  onClose,
  nested = false,
}: {
  threads: readonly NativeChildThread[];
  selectedThreadId: string | null;
  onOpen: (thread: NativeChildThread) => void;
  onClose: (thread: NativeChildThread) => Promise<void>;
  nested?: boolean;
}) {
  return (
    <div
      data-threadflow-children
      className={nested ? "mt-0.5 space-y-0.5 pl-2" : "mt-0.5 space-y-0.5"}
    >
      {threads.map((child) => (
        <div key={child.id}>
          <div
            className={
              selectedThreadId === child.id
                ? "flex w-full items-center gap-1 rounded bg-muted/60 px-1 py-0.5 text-left text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-muted-foreground/40"
                : "flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-1 focus-visible:ring-muted-foreground/40"
            }
          >
            <a
              href={`/threads/${encodeURIComponent(child.id)}`}
              aria-label={child.title}
              data-threadflow-row
              data-thread-id={child.id}
              data-side-chat-id={child.id}
              data-source-thread-id={child.parentThreadId}
              onClick={(event) => {
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                event.stopPropagation();
                onOpen(child);
              }}
              className="flex min-w-0 flex-1 items-center gap-1 text-left outline-none"
            >
              <ChildThreadStatus thread={child} />
              <span
                draggable
                title="Drag into Journal"
                className="flex min-w-0 flex-1 cursor-grab select-none items-center gap-1 active:cursor-grabbing"
                onDragStart={(event) => {
                  event.stopPropagation();
                  setThreadReferenceDragData(
                    event.dataTransfer,
                    child.id,
                    child.title,
                  );
                }}
              >
                <ThreadTitleContent title={child.title} />
              </span>
              <BackgroundWorkBadge count={child.backgroundWork} />
            </a>
            {child.closeable ? (
              <button
                type="button"
                aria-label={`Close ${child.title}`}
                title="Close side chat"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void onClose(child);
                }}
                className="shrink-0 rounded p-0.5 opacity-40 hover:bg-background hover:opacity-100"
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
            ) : null}
          </div>
          {child.children.length === 0 ? null : (
            <ChildThreadRows
              threads={child.children}
              selectedThreadId={selectedThreadId}
              onOpen={onOpen}
              onClose={onClose}
              nested
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ThreadBrandMark({
  brand,
  className = "size-3",
}: {
  brand: ThreadTitleBrand;
  className?: string;
}) {
  const label = brand === "bb" ? "BB" : "Bogi";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
    >
      {brand === "bb" ? (
        <img
          src={BB_LOGO_DATA_URL}
          alt=""
          className="size-full rounded-[0.18em]"
        />
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 300 326"
          fill="none"
          className="size-full"
        >
          <g transform="translate(300 0) scale(-1 1)">
            <path
              d="M104.494 309.332C81.9045 296.235 59.7038 283.197 37.3073 270.505C13.0366 256.75 0.433367 236.144 0.224508 208.26C-0.00384286 177.773 -0.0973071 147.283 0.133253 116.796C0.342505 89.128 13.0094 68.5206 36.8846 54.7555C62.3559 40.0703 87.9548 25.605 113.356 10.7997C137.819 -3.45937 162.055 -3.68356 186.583 10.6332C212.68 25.8651 239.031 40.6613 265.112 55.9189C287.205 68.8437 299.395 88.3415 299.859 113.936C300.453 146.734 300.326 179.561 299.681 212.36C299.206 236.534 288.466 255.42 267.175 267.729C238.274 284.437 209.56 301.483 180.381 317.692C161.393 328.24 141.518 328.02 121.894 318.761C116.047 316.002 110.488 312.632 104.494 309.332ZM192.607 143.085C186.277 146.736 180.054 150.59 173.593 153.991C163.544 159.282 159.086 167.356 159.315 178.719C159.694 197.531 159.551 216.354 159.593 235.173C159.625 249.498 159.401 263.827 159.664 278.147C159.905 291.344 169.674 297.19 181.588 291.593C182.937 290.959 184.217 289.173 185.511 289.426C202.621 279.543 219.761 269.708 236.824 259.744C245.704 254.559 255.091 249.961 263.125 243.664C281.704 229.103 281.697 200.634 263.998 185.635C262.913 184.715 262.43 181.679 263.101 180.354C265.192 176.225 267.862 172.37 270.51 168.549C275.122 161.892 277.336 154.675 276.966 146.502C276.651 139.525 276.781 132.514 277.019 125.528C277.255 118.64 275.067 113.05 269.082 109.412C262.972 105.699 256.726 106.083 250.633 109.602C231.506 120.65 212.396 131.728 192.607 143.085ZM42.4736 223.875C46.6551 226.264 50.8341 228.658 55.0187 231.042C61.2316 234.581 63.9591 233.036 63.9647 225.906C63.9831 202.918 63.7819 179.928 64.0689 156.944C64.1773 148.263 60.8115 142.279 53.2011 138.424C51.2805 137.452 49.4608 136.28 47.5922 135.204C38.9783 130.244 32.7558 133.734 32.742 143.596C32.7126 164.751 32.9865 185.911 32.5996 207.06C32.4585 214.774 34.6289 220.348 42.4736 223.875ZM86.733 188.428C86.7333 206.065 86.7809 223.702 86.7055 241.338C86.6827 246.678 88.7735 250.521 93.4947 253.117C99.0176 256.153 104.374 259.491 109.878 262.563C114.88 265.355 117.939 263.607 117.95 257.91C117.999 233.618 117.991 209.326 117.954 185.033C117.946 179.291 115.421 174.731 110.659 171.607C107.063 169.248 103.327 167.062 99.4918 165.117C92.9672 161.809 86.9565 165.543 86.7592 172.953C86.6308 177.775 86.7337 182.603 86.733 188.428Z"
              fill="currentColor"
            />
          </g>
        </svg>
      )}
    </span>
  );
}

function ThreadTitleContent({ title }: { title: string }) {
  const brandedTitle = parseThreadTitleBrand(title);
  return (
    <>
      {brandedTitle.brand === null ? null : (
        <ThreadBrandMark brand={brandedTitle.brand} />
      )}
      <span className="min-w-0 truncate">{brandedTitle.title}</span>
    </>
  );
}

function setThreadReferenceDragData(
  dataTransfer: DataTransfer,
  threadId: string,
  title: string,
): void {
  const brandedTitle = parseThreadTitleBrand(title);
  const reference = {
    id: threadId,
    title: brandedTitle.title.trim() || title.trim() || "Untitled thread",
  };
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(
    THREAD_REFERENCE_DRAG_TYPE,
    serializeThreadReferenceDrag(reference),
  );
  dataTransfer.setData("text/plain", threadReferenceMarkdown(reference));
}

function SidebarThreadRow({
  thread,
  backgroundCommands,
  pullRequest,
  shortcutNumber,
  showShortcutNumber,
  selectedThreadId,
  onOpen,
  onOpenChild,
  onCloseChild,
  onRename,
  showWorkingDuration,
}: {
  thread: NativeThread;
  backgroundCommands: number;
  pullRequest: PluginSidebarPullRequest | null;
  shortcutNumber: number;
  showShortcutNumber: boolean;
  selectedThreadId: string | null;
  onOpen: (thread: NativeThread) => void;
  onOpenChild: (child: NativeChildThread) => void;
  onCloseChild: (child: NativeChildThread) => Promise<void>;
  onRename: (thread: NativeThread, title: string) => Promise<void>;
  showWorkingDuration: boolean;
}) {
  const { splitProps } = experimental_useSidebarThreadSplit(thread.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title);
  const [saving, setSaving] = useState(false);
  const selected =
    selectedThreadId === thread.id ||
    flattenChildThreads(thread.children).some(
      (child) => child.id === selectedThreadId,
    );

  useEffect(() => {
    if (!editing) setDraft(thread.title);
  }, [editing, thread.title]);

  const save = async () => {
    if (saving) return;
    const title = draft.trim();
    if (title === "" || title === thread.title) {
      setDraft(thread.title);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onRename(thread, title);
      setEditing(false);
    } catch {
      // Keep the input open; the list-level error explains the failure.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={
        selected
          ? "group cursor-pointer rounded-md bg-muted/60 px-2 py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-muted-foreground/40"
          : "group cursor-pointer rounded-md px-2 py-1.5 outline-none hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-muted-foreground/40"
      }
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <a
          {...splitProps}
          href={`/threads/${encodeURIComponent(thread.id)}`}
          data-threadflow-row
          data-sidebar-thread-shortcut-target=""
          data-sidebar-thread-id={thread.id}
          data-thread-id={thread.id}
          aria-label={thread.title}
          aria-current={selected ? "true" : undefined}
          onClick={(event) => {
            if (
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            onOpen(thread);
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-muted-foreground/40"
        >
          {showShortcutNumber && shortcutNumber <= 9 ? (
            <kbd className="shrink-0 font-mono text-[9px] text-muted-foreground">
              {shortcutNumber}
            </kbd>
          ) : null}
          <BackgroundCommandIndicator count={backgroundCommands} />
          <BackgroundWorkBadge count={thread.backgroundWork} />
          <span
            draggable
            title="Drag into Journal"
            className="flex min-w-0 flex-1 cursor-grab select-none items-center gap-1 text-xs font-normal text-foreground active:cursor-grabbing"
            onPointerDown={(event) => event.stopPropagation()}
            onDragStart={(event) => {
              event.stopPropagation();
              setThreadReferenceDragData(
                event.dataTransfer,
                thread.id,
                thread.title,
              );
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDraft(thread.title);
              setEditing(true);
            }}
          >
            <ThreadTitleContent title={thread.title} />
          </span>
          <span className="flex h-5 w-12 shrink-0 items-center justify-end text-right text-[9px] text-muted-foreground">
            <time
              dateTime={new Date(
                thread.scheduledSendAt ?? thread.updatedAt,
              ).toISOString()}
            >
              {thread.scheduledSendAt !== null
                ? futureTime(thread.scheduledSendAt)
                : showWorkingDuration
                  ? elapsedTime(thread.updatedAt)
                  : relativeTime(thread.updatedAt)}
            </time>
          </span>
        </a>
        {pullRequest === null ? null : (
          <PullRequestLink pullRequest={pullRequest} />
        )}
        <ArchiveThreadButton threadId={thread.id} title={thread.title} />
      </div>
      {thread.children.length === 0 ? null : (
        <ChildThreadRows
          threads={thread.children}
          selectedThreadId={selectedThreadId}
          onOpen={onOpenChild}
          onClose={onCloseChild}
        />
      )}
      <Dialog
        open={editing}
        onOpenChange={(open) => {
          if (saving) return;
          setEditing(open);
          if (!open) setDraft(thread.title);
        }}
      >
        <DialogContent
          className="sm:max-w-sm"
          onClick={(event) => event.stopPropagation()}
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename thread</DialogTitle>
            </DialogHeader>
            <Input
              autoFocus
              value={draft}
              maxLength={160}
              disabled={saving}
              aria-label="Thread title"
              onChange={(event) => setDraft(event.target.value)}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || draft.trim() === ""}>
                {saving ? "Renaming…" : "Rename"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ArchivedThreadList({ onNavigate }: PluginThreadListProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const {
    threads: historyThreads,
    error: historyError,
    archive,
  } = useThreadflowThreads("all");
  const threads = historyThreads
    .filter((thread) => thread.archived)
    .sort(
      (a, b) => (b.archivedAt ?? b.updatedAt) - (a.archivedAt ?? a.updatedAt),
    );
  const [restoringThreadIds, setRestoringThreadIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const grouped = new Map<string, NativeThread[]>();
    for (const thread of threads) {
      const label = formatJournalDayGroup(
        thread.archivedAt ?? thread.updatedAt,
      );
      const group = grouped.get(label) ?? [];
      group.push(thread);
      grouped.set(label, group);
    }
    return [...grouped.entries()];
  }, [threads]);

  const restore = useCallback(
    async (thread: NativeThread) => {
      setRestoringThreadIds((current) => new Set(current).add(thread.id));
      try {
        await rpc.call("toggle_archived", { id: thread.id });

        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setRestoringThreadIds((current) => {
          const next = new Set(current);
          next.delete(thread.id);
          return next;
        });
      }
    },
    [rpc],
  );

  return (
    <div className="flex min-h-full flex-col px-2 pb-3 pt-1">
      <div className="sticky top-0 z-10 flex items-center justify-between bg-sidebar py-2">
        <span className="text-xs font-medium text-sidebar-foreground">
          Archived
        </span>
        <button
          type="button"
          onClick={() => setSidebarMode("threads")}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-muted-foreground/40"
        >
          Back to threads
        </button>
      </div>
      {error === null && historyError === null ? null : (
        <p className="px-1 py-2 text-xs text-destructive">
          {error ?? historyError}
        </p>
      )}
      {groups.length === 0 && error === null ? (
        <p className="px-1 py-8 text-center text-xs text-muted-foreground">
          No archived threads
        </p>
      ) : (
        groups.map(([label, groupThreads]) => (
          <section key={label} className="mb-3">
            <h2 className="px-1 pb-1 pt-2 text-xs font-medium text-muted-foreground">
              {label}
            </h2>
            <div className="space-y-0.5">
              {groupThreads.map((thread) => {
                const restoring = restoringThreadIds.has(thread.id);
                return (
                  <div
                    key={thread.id}
                    className="flex items-center gap-1 rounded-md hover:bg-muted/50"
                  >
                    <a
                      href={`/threads/${encodeURIComponent(thread.id)}`}
                      data-threadflow-row
                      data-thread-id={thread.id}
                      data-sidebar-thread-shortcut-target=""
                      data-sidebar-thread-id={thread.id}
                      onClick={(event) => {
                        if (
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey
                        )
                          return;
                        event.preventDefault();
                        navigate.toThread(thread.id);
                        onNavigate();
                      }}
                      className="min-w-0 flex-1 px-1.5 py-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-muted-foreground/40"
                    >
                      <span className="block truncate text-xs text-sidebar-foreground">
                        {thread.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {thread.project}
                      </span>
                    </a>
                    <button
                      type="button"
                      aria-label={`Unarchive ${thread.title}`}
                      title="Unarchive"
                      disabled={restoring}
                      onClick={() => void restore(thread)}
                      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-1 focus-visible:ring-muted-foreground/40 disabled:opacity-40"
                    >
                      <HugeiconsIcon
                        icon={ArchiveRestoreIcon}
                        className="size-4"
                        aria-hidden
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
      {archive?.hasNextPage ? (
        <button
          type="button"
          disabled={archive.isFetchingNextPage}
          onClick={() => void archive.fetchNextPage()}
        >
          Load older threads
        </button>
      ) : null}
    </div>
  );
}

function ActiveThreadList({
  activeThreadId,
  onNavigate,
}: PluginThreadListProps) {
  const rpc = useRpc<typeof rpcContract>();
  const { threads: nativeSidebarThreads } = experimental_useSidebarThreads();
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
  const { threads, error: loadError, refresh } = useThreadflowThreads("recent");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    activeThreadId,
  );
  const [pullRequests, setPullRequests] = useState<
    Record<string, PluginSidebarPullRequest | null>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [showShortcutNumbers, setShowShortcutNumbers] = useState(false);
  const [waitingCollapsed, setWaitingCollapsed] = useState(() => {
    try {
      return (
        window.localStorage.getItem(WAITING_COLLAPSED_STORAGE_KEY) === "true"
      );
    } catch {
      return false;
    }
  });
  const [sidebarLabelCase, setSidebarLabelCase] = useState<SidebarLabelCase>(
    () => {
      try {
        const stored = window.localStorage.getItem(
          SIDEBAR_LABEL_CASE_STORAGE_KEY,
        );
        return stored === "capital" || stored === "upper" ? stored : "lower";
      } catch {
        return "lower";
      }
    },
  );
  const listRef = useRef<HTMLDivElement>(null);
  const keepSidebarFocusRef = useRef(false);
  const runThreadCommand = useThreadCommand(selectedThreadId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Meta" || event.metaKey) setShowShortcutNumbers(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Meta" || !event.metaKey) setShowShortcutNumbers(false);
    };
    const hideShortcutNumbers = () => setShowShortcutNumbers(false);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", hideShortcutNumbers);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", hideShortcutNumbers);
    };
  }, []);

  const toggleWaitingCollapsed = useCallback(() => {
    setWaitingCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        window.localStorage.setItem(
          WAITING_COLLAPSED_STORAGE_KEY,
          String(next),
        );
      } catch {
        // The in-memory state still works when browser storage is unavailable.
      }
      return next;
    });
  }, []);

  const cycleSidebarLabelCase = useCallback(() => {
    setSidebarLabelCase((current) => {
      const next = nextSidebarLabelCase(current);
      try {
        window.localStorage.setItem(SIDEBAR_LABEL_CASE_STORAGE_KEY, next);
      } catch {
        // The in-memory state still works when browser storage is unavailable.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (activeThreadId !== null) setSelectedThreadId(activeThreadId);
  }, [activeThreadId]);

  const recordPullRequest = useCallback(
    (threadId: string, pullRequest: PluginSidebarPullRequest | null) => {
      setPullRequests((current) => ({ ...current, [threadId]: pullRequest }));
    },
    [],
  );
  const { groups, dependenciesByParentId } = useMemo(
    () => groupSidebarThreads(threads, pullRequests),
    [pullRequests, threads],
  );
  const flatThreads = useMemo(
    () =>
      groups.flatMap(([, groupThreads]) =>
        groupThreads.flatMap((thread) => [
          thread,
          ...(dependenciesByParentId.get(thread.id) ?? []),
        ]),
      ),
    [dependenciesByParentId, groups],
  );
  const nativeThreadById = useMemo(
    () => new Map(nativeSidebarThreads.map((thread) => [thread.id, thread])),
    [nativeSidebarThreads],
  );

  const focusSidebarRow = useCallback((threadId: string | null) => {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-threadflow-row]") ??
        [],
    );
    const row =
      rows.find((candidate) => candidate.dataset.threadId === threadId) ??
      rows[0];
    setKeyboardFocusMode("sidebar");
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }, []);

  const openThread = useCallback(
    (threadId: string, keepSidebarFocus = false) => {
      keepSidebarFocusRef.current = keepSidebarFocus;
      setKeyboardFocusMode(keepSidebarFocus ? "sidebar" : "chat");
      setSelectedThreadId(threadId);
      actions.open(threadId);
      onNavigate();
      if (keepSidebarFocus) {
        window.requestAnimationFrame(() => focusSidebarRow(threadId));
      }
    },
    [actions, focusSidebarRow, onNavigate],
  );

  const openChildThread = useCallback(
    (child: NativeChildThread, keepSidebarFocus = false) => {
      keepSidebarFocusRef.current = keepSidebarFocus;
      setKeyboardFocusMode(keepSidebarFocus ? "sidebar" : "chat");
      setSelectedThreadId(child.id);
      if (child.navigation === "thread") {
        navigate.toThread(child.id);
      } else {
        actions.open(child.id, { split: true });
      }
      onNavigate();
      if (keepSidebarFocus)
        window.requestAnimationFrame(() => focusSidebarRow(child.id));
    },
    [actions, focusSidebarRow, navigate, onNavigate],
  );

  const openSidebarTarget = useCallback(
    (threadId: string, keepSidebarFocus = false) => {
      const child = threads
        .flatMap((thread) => flattenChildThreads(thread.children))
        .find((candidate) => candidate.id === threadId);
      if (child !== undefined) openChildThread(child, keepSidebarFocus);
      else openThread(threadId, keepSidebarFocus);
    },
    [openChildThread, openThread, threads],
  );

  const renameThread = useCallback(
    async (thread: NativeThread, title: string) => {
      try {
        await actions.rename(thread.id, title);
        await refresh();
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      }
    },
    [actions, refresh],
  );

  const closeChildThread = useCallback(
    async (child: NativeChildThread) => {
      try {
        await rpc.call("close_side_chat", { threadId: child.id });
        setSelectedThreadId(child.parentThreadId);
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [refresh, rpc],
  );

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      const inSidebar =
        target !== null && listRef.current?.contains(target) === true;
      keepSidebarFocusRef.current = inSidebar;
      setKeyboardFocusMode(inSidebar ? "sidebar" : "chat");
    };
    const onFocusIn = (event: FocusEvent) => {
      const list = listRef.current;
      const target = event.target instanceof Node ? event.target : null;
      if (list === null || target === null) return;
      if (list.contains(target)) {
        keepSidebarFocusRef.current = true;
        setKeyboardFocusMode("sidebar");
        return;
      }
      keepSidebarFocusRef.current = false;
      setKeyboardFocusMode("chat");
    };
    const onReturnToSidebar = (event: Event) => {
      const threadId = (event as CustomEvent<unknown>).detail;
      if (typeof threadId !== "string") return;
      // Never move focus to some other row when the sent thread isn't listed.
      const listed = Array.from(
        listRef.current?.querySelectorAll<HTMLElement>(
          "[data-threadflow-row]",
        ) ?? [],
      ).some((row) => row.dataset.threadId === threadId);
      if (!listed) return;
      keepSidebarFocusRef.current = true;
      setSelectedThreadId(threadId);
      window.requestAnimationFrame(() => focusSidebarRow(threadId));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const commandKey = event.key.toLocaleLowerCase();
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        event.defaultPrevented ||
        event.isComposing ||
        target?.closest(
          '[role="dialog"], [role="menu"], input, textarea, select, [contenteditable="true"]',
        )
      )
        return;
      if (
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.shiftKey &&
        commandKey === "t"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) {
          void runThreadCommand(commandKey, true).catch((cause) =>
            toast.error(cause instanceof Error ? cause.message : String(cause)),
          );
        }
        return;
      }
      if (
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.shiftKey &&
        commandKey === "e" &&
        listRef.current?.contains(document.activeElement)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void runThreadCommand(commandKey, event.shiftKey).catch((cause) =>
          toast.error(cause instanceof Error ? cause.message : String(cause)),
        );
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const list = listRef.current;
      if (list === null) return;

      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const focusInside =
        activeElement !== null && list.contains(activeElement);

      // Escape from outside the list is handled after BB in onEscapeBubble.
      if (event.key === "Escape") {
        if (!focusInside) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const activeSummary =
          activeElement?.closest<HTMLElement>(
            '[data-threadflow-summary-open="true"]',
          ) ?? null;
        const openSummary =
          activeSummary ??
          document.querySelector<HTMLElement>(
            '[data-threadflow-summary-open="true"]',
          );
        const summaryThreadId = openSummary?.dataset.threadflowSummaryThreadId;
        if (summaryThreadId !== undefined) {
          window.dispatchEvent(
            new CustomEvent<string>(DISMISS_CHAT_SUMMARY_EVENT, {
              detail: summaryThreadId,
            }),
          );
          return;
        }
        const mode = getKeyboardFocusMode();
        if (mode === "sidebar") {
          keepSidebarFocusRef.current = false;
          setKeyboardFocusMode("chat");
          if (activeElement !== null && list.contains(activeElement))
            activeElement.blur();
        } else {
          keepSidebarFocusRef.current = true;
          focusSidebarRow(selectedThreadId);
        }
        return;
      }

      if (event.key === "/" && (focusInside || keepSidebarFocusRef.current))
        return;

      if (!focusInside || !target?.matches("[data-threadflow-row]")) return;

      const rows = Array.from(
        list.querySelectorAll<HTMLElement>("[data-threadflow-row]"),
      );
      if (rows.length === 0) return;
      const current =
        target?.closest<HTMLElement>("[data-threadflow-row]") ??
        rows.find((row) => row.dataset.threadId === selectedThreadId) ??
        rows[0];

      if (event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const threadId = current.dataset.threadId;
        if (threadId !== undefined) openSidebarTarget(threadId, true);
        return;
      }

      if (
        event.key.length === 1 &&
        event.key.trim() !== "" &&
        selectedThreadId !== null
      ) {
        const detail: TypeInChatDetail = {
          threadId: selectedThreadId,
          text: event.key,
        };
        window.dispatchEvent(
          new CustomEvent<TypeInChatDetail>(TYPE_IN_CHAT_EVENT, { detail }),
        );
        // Leave the key alone when no open composer took it.
        if (!detail.handled) return;
        keepSidebarFocusRef.current = false;
        setKeyboardFocusMode("chat");
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    // Escape with nothing focused toggles into the sidebar, but only after BB
    // and its panels have had their turn and left the key unhandled.
    const onEscapeBubble = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target !== document.body &&
          event.target !== document.documentElement)
      )
        return;
      const openSummary = document.querySelector<HTMLElement>(
        '[data-threadflow-summary-open="true"]',
      );
      const summaryThreadId = openSummary?.dataset.threadflowSummaryThreadId;
      if (summaryThreadId !== undefined) {
        window.dispatchEvent(
          new CustomEvent<string>(DISMISS_CHAT_SUMMARY_EVENT, {
            detail: summaryThreadId,
          }),
        );
        return;
      }
      keepSidebarFocusRef.current = true;
      focusSidebarRow(selectedThreadId);
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keydown", onEscapeBubble);
    window.addEventListener(RETURN_TO_SIDEBAR_EVENT, onReturnToSidebar);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keydown", onEscapeBubble);
      window.removeEventListener(RETURN_TO_SIDEBAR_EVENT, onReturnToSidebar);
    };
  }, [
    flatThreads,
    focusSidebarRow,
    openSidebarTarget,
    runThreadCommand,
    selectedThreadId,
  ]);

  const renderThreadRow = (
    thread: NativeThread,
    showWorkingDuration: boolean,
  ) => (
    <SidebarThreadRow
      key={thread.id}
      thread={thread}
      backgroundCommands={
        nativeThreadById.get(thread.id)?.activity.backgroundCommands ?? 0
      }
      pullRequest={pullRequests[thread.id] ?? null}
      shortcutNumber={flatThreads.indexOf(thread) + 1}
      showShortcutNumber={showShortcutNumbers}
      selectedThreadId={selectedThreadId}
      onOpen={(candidate) => openThread(candidate.id)}
      onOpenChild={(child) => openChildThread(child)}
      onCloseChild={closeChildThread}
      onRename={renameThread}
      showWorkingDuration={showWorkingDuration}
    />
  );

  return (
    <div ref={listRef} className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {threads.map((thread) => (
          <PullRequestProbe
            key={thread.id}
            threadId={thread.id}
            onChange={recordPullRequest}
          />
        ))}
        {error === null && loadError === null ? null : (
          <p className="px-2 py-1 text-[10px] text-destructive">
            {error ?? loadError}
          </p>
        )}
        <div className="space-y-3">
          {groups.map(([title, groupThreads]) =>
            groupThreads.length === 0 ? null : (
              <section
                key={title}
                className={
                  title === "Working" || title === "Waiting"
                    ? "opacity-50"
                    : undefined
                }
              >
                <div className="flex w-full items-center justify-between px-2 pb-1 text-[10px] font-normal tracking-normal text-muted-foreground">
                  <button
                    type="button"
                    title="Cycle label capitalization"
                    className="rounded-sm outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-muted-foreground/40"
                    onClick={cycleSidebarLabelCase}
                  >
                    {formatSidebarLabel(title, sidebarLabelCase)}
                  </button>
                  {title === "Waiting" ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-muted-foreground/40"
                      aria-label={
                        waitingCollapsed
                          ? "Expand snoozed section"
                          : "Collapse snoozed section"
                      }
                      aria-expanded={!waitingCollapsed}
                      onClick={toggleWaitingCollapsed}
                    >
                      {waitingCollapsed ? (
                        <span>{groupThreads.length}</span>
                      ) : null}
                      <HugeiconsIcon
                        icon={ArrowRight01Icon}
                        className={`size-3 transition-transform ${waitingCollapsed ? "" : "rotate-90"}`}
                        aria-hidden
                      />
                    </button>
                  ) : null}
                </div>
                {title === "Waiting" && waitingCollapsed ? null : (
                  <div className="space-y-0.5">
                    {groupThreads.map((thread) => {
                      const dependencies =
                        dependenciesByParentId.get(thread.id) ?? [];
                      return (
                        <div key={thread.id}>
                          {renderThreadRow(thread, title === "Working")}
                          {dependencies.length === 0 ? null : (
                            <div data-threadflow-children className="mt-0.5 space-y-0.5 pl-2">
                              {dependencies.map((dependency) =>
                                renderThreadRow(dependency, true),
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

export function CompactThreadList(props: PluginThreadListProps) {
  const mode = useSidebarMode();
  const navigate = useBbNavigate();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-3 py-2 text-xs">
        <button
          type="button"
          onClick={() =>
            setSidebarMode(mode === "history" ? "threads" : "history")
          }
          aria-label={
            mode === "history" ? "Show active threads" : "Show archived threads"
          }
        >
          {mode === "history" ? "Active" : "History"}
        </button>
        <button
          type="button"
          onClick={() => navigate.toCompose({ focusPrompt: true })}
        >
          New thread
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {mode === "history" ? (
          <ArchivedThreadList {...props} />
        ) : (
          <ActiveThreadList {...props} />
        )}
      </div>
    </div>
  );
}
