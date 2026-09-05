import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  File01Icon,
} from "@hugeicons/core-free-icons";
import {
  Markdown,
  ThreadChat,
  UrlLink,
  definePluginApp,
  experimental_useSidebarThreads,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit,
  useBbContext,
  useBbNavigate,
  useComposer,
  useComposerView,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type {
  ExperimentalSidebarNavigationProps,
  PluginNavPanelProps,
  PluginSidebarPullRequest,
  PluginThreadHeaderActionProps,
  PluginThreadListProps,
  PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { NativeSideChat, NativeThread, rpcContract } from "./server";
import { ContextSwitchGuard } from "./context-switch-guard";
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
  appendUsageSample,
  calculateTodayUsedPercent,
  parseUsageSamples,
  type TodayUsageEstimate,
  type UsageSample,
} from "./usage-tracking";
import { parseThreadTitleBrand, type ThreadTitleBrand } from "./thread-title-brand";
import { isThreadNudgerMessageText } from "./thread-nudger-message";
import { formatUserMessageTimestamp, type UserMessageTimestamp } from "./user-message-timestamp";
import { JournalMarkdownEditor } from "./journal-editor";
import { classifyThreadListState, threadIsWorking } from "./thread-list-state";
import {
  formatJournalDate,
  isJournalDateKey,
  localJournalDateKey,
  shiftJournalDateKey,
} from "./journal-date";

type ChatTarget = {
  id: string;
  title: string;
  createdAt: number;
  project?: string;
  worktree: string | null;
  sourceThreadId?: string;
  accentTitle?: string;
  accentCreatedAt?: number;
};
type TypeInChatDetail = { threadId: string; text: string };

const TYPE_IN_CHAT_EVENT = "threadflow:type-in-chat";
const THREADS_CHANGED_CHANNEL = "threads-changed";
const RETURN_TO_SIDEBAR_EVENT = "threadflow:return-to-sidebar";
const KEYBOARD_FOCUS_MODE_EVENT = "threadflow:keyboard-focus-mode";
const DISMISS_CHAT_SUMMARY_EVENT = "threadflow:dismiss-chat-summary";
const SUMMARIES_CHANGED_CHANNEL = "chat-summaries-changed";
const HANDOFFS_CHANGED_CHANNEL = "side-chat-handoffs-changed";
const REVIEW_WORKTREE_PROMPT = "Review the changes in this worktree";
const ASK_LINUS_PROMPT = "how would linus torvalds feel about this";
const USAGE_SAMPLES_STORAGE_KEY = "threadflow:codex-usage-samples:v1";
const BB_LOGO_DATA_URL = "data:image/webp;base64,"
  + "UklGRqwDAABXRUJQVlA4TKADAAAvL8ALEJUGQbbN66+9nCEiJmANn1izbSRJUf5Rt3OzR/9vHz1TBKMAYJQc7pJB+0CbNVkBnhTY"
  + "E9cW64CDI7eNHImeueWwrn2DbEmyTdt6t7m5ONexbdu2bfuca9u2bdu2bdvWwlxx/8A6EhAU+T/aBPSfgdtGirzHDJ19RFm6oGDg4"
  + "BEQSo5yYlwR0MkoAJAKomFkZmVzUs66Qe0C/uMLgUXeYG7+wDxw69WLiJL9jsozDt9KfUfnspc67q/QRrX0J4WnWydqd5K0T5HBa"
  + "TyH+q2zvuIAm/sA3p5fAbd6zjBcMSCfpzC85zIneQFseBRo2GactlBYcA7aWxYYU5d24iUQoH6rxpZvmGS0doD5eh/aKbJ1x7QO"
  + "XAR2oHzDGJC6QzdDsBSxgg/QlpmIG0b6ehcICMOFQ6MOkocHhoidDuOew4zQEWCp74GgOV14jGo2oVoNGcUJaLdXgY/mYkyjBYK"
  + "xuAiYde9a7CWnPkeWO2K1VtF3I4jARmL6O+5HWrgXmQ8XIas4S4DUkJloP/P91JryZDTHHoD6PNnHZGpWSCfmcQU2VkLBJhaij4n"
  + "BBumkCfgFU73yzADqXDRTTKYz4chZ6GM+q/cWJjavD1RivUJzibr3Q5a3bC3UGECkLmCCaSocMTM9iVqiaVsrX3eIWJ4NFpnueK/"
  + "ylnecJQoBRtMX3Q9Ds+hLZ1JINMmI5XEfnnYRQ9GKLWQNjL9eBo6RQNTw7eQNH/mzlWxi9MON3fI0iTATjN1IGD/iIQFQUOILhpG"
  + "qlzTpr71GWwo/T8jVbe76cZQW2mHMwMQ1dC0fob2jM7bqi7IYFsiFTuCiqYaG+BCGCUhEhi6B5zA8IxWgSKnbYV0IkpN1GgH2Lc"
  + "AO2j1C+IOPoAcfYTiAOYKpaLWbsHICyeEaKZAJZ7zjtLS0vKQrqOSMQOwCM2oFaKo6WWtg5xCS86OYTIDOtJbKMW6xnyoNMZglHf"
  + "IL2EO+eEBnRKhMbnoch51zSB29IHVaEyhEMjsCcMQMG11xUlN5kVWzk8PMIwlEjSmq+Ulw1BGsTvfpqHgYFIZazF53fOqLjgpKZ4"
  + "Yn4QRpC0CMuqIN9C0cdertgf1maTtzbOaoB+E0soGK6WqJDxGE8tcSEsmcN5d3cPQDAT3znH3MYDijWZRTvKblBYsoI4VYgnDV2S"
  + "iGcQXOfsbssYA84ww72MAWTvIESD+WvifT93Dynk8/R5LPqeRzMPmcTT3H0/5PWLgU";
const VIEWER_CLIENT_ID = `native-chat-${Math.random().toString(36).slice(2)}`;
const MESSAGE_BUBBLE_TAIL_PATH = "M8.33594 0.5C8.7668 0.821894 9.07248 1.04615 9.30176 1.21094C9.55938 1.3961 9.70552 1.49813 9.8252 1.58789C9.97196 1.69798 10.063 1.78007 10.2666 1.97949C9.91758 2.45087 9.86145 3.11747 9.9082 3.72559C9.97604 4.60748 10.2761 5.65946 10.6572 6.67578C11.041 7.69919 11.519 8.71995 11.9658 9.5498C12.3707 10.3016 12.7783 10.9463 13.0811 11.2812C13.1997 11.5187 13.2999 11.7209 13.3594 11.9004C13.3992 12.0208 13.4042 12.0854 13.4043 12.1133C13.3726 12.1293 13.2986 12.1562 13.1455 12.1699C12.8453 12.1969 12.3568 12.1616 11.5977 12.0098C9.22996 11.5361 7.06273 9.98557 5.25586 8.49023C4.3835 7.76828 3.54044 7.01048 2.88281 6.48438C2.54469 6.21388 2.22287 5.97683 1.92773 5.80566C1.64508 5.64174 1.32344 5.5 1 5.5H0.5V0.5H8.33594Z";
const MESSAGE_BUBBLE_TAIL_ATTRIBUTE = "data-threadflow-user-bubble-tail";
const MESSAGE_BUBBLE_TAIL_SPACER_ATTRIBUTE = "data-threadflow-user-bubble-tail-spacer";
const MESSAGE_TIMESTAMP_ATTRIBUTE = "data-threadflow-user-message-timestamp";
const MESSAGE_TIMESTAMP_HOST_ATTRIBUTE = "data-threadflow-user-message-timestamp-host";
const NUDGER_MESSAGE_ATTRIBUTE = "data-threadflow-nudger-message";
const NATIVE_USER_MESSAGE_SELECTOR = `[data-message-column] > [class~="group/message"][class~="ml-auto"]`;
const NATIVE_USER_BUBBLE_RELATIVE_SELECTOR = `:scope > [class~="w-fit"][class~="flex-col"] > [class~="bg-surface-recessed"]`;
const NATIVE_USER_BUBBLE_SELECTOR = `${NATIVE_USER_MESSAGE_SELECTOR} > [class~="w-fit"][class~="flex-col"] > [class~="bg-surface-recessed"]`;
const NATIVE_STEER_HEADER_SELECTOR = `:scope > [class~="mb-1"][class~="justify-end"]:has(> span[class~="whitespace-nowrap"])`;
const NATIVE_CHAT_CSS = `
  [${NUDGER_MESSAGE_ATTRIBUTE}] {
    display: none !important;
  }

  ${NATIVE_USER_BUBBLE_SELECTOR} {
    position: relative !important;
    border: 0 !important;
    border-radius: 1rem !important;
    background-color: var(--surface-recessed-solid) !important;
    padding: 0.375rem 0.75rem !important;
  }

  [${MESSAGE_BUBBLE_TAIL_ATTRIBUTE}] {
    position: absolute;
    right: 4px;
    bottom: -7px;
    z-index: 10;
    width: 14px;
    height: 13px;
    pointer-events: none;
    color: var(--surface-recessed-solid);
  }

  [${MESSAGE_BUBBLE_TAIL_SPACER_ATTRIBUTE}] {
    margin-bottom: 7px !important;
  }

  [${MESSAGE_TIMESTAMP_HOST_ATTRIBUTE}] {
    position: relative !important;
    margin-bottom: 1rem !important;
  }

  [${MESSAGE_TIMESTAMP_ATTRIBUTE}] {
    position: absolute;
    top: calc(100% + 3px);
    right: 1.25rem;
    z-index: 12;
    white-space: nowrap;
    pointer-events: none;
    color: var(--muted-foreground);
    font-size: 10px;
    line-height: 1;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  [${MESSAGE_TIMESTAMP_HOST_ATTRIBUTE}]:hover > [${MESSAGE_TIMESTAMP_ATTRIBUTE}] {
    opacity: 0.65;
  }
`;
const JOURNAL_EDITOR_CSS = `
  .threadflow-journal-editor .tiptap {
    min-height: 100%;
    padding-bottom: 35vh;
    color: var(--foreground);
    font-size: 1rem;
    line-height: 1.75;
    outline: none;
    overflow-wrap: break-word;
    tab-size: 2;
  }

  .threadflow-journal-editor .tiptap > :first-child,
  .threadflow-journal-editor .tiptap li > :first-child,
  .threadflow-journal-editor .tiptap blockquote > :first-child {
    margin-top: 0;
  }

  .threadflow-journal-editor .tiptap p {
    margin-top: 1em;
  }

  .threadflow-journal-editor .tiptap :is(h1, h2, h3, h4, h5, h6) {
    margin-bottom: 0;
    color: var(--foreground);
    font-weight: 600;
  }

  .threadflow-journal-editor .tiptap h1 { margin-top: 1.25em; font-size: 1.75em; line-height: 1.3; }
  .threadflow-journal-editor .tiptap h2 { margin-top: 1.6em; font-size: 1.35em; line-height: 1.4; }
  .threadflow-journal-editor .tiptap h3 { margin-top: 1.35em; font-size: 1.15em; line-height: 1.45; }
  .threadflow-journal-editor .tiptap :is(h4, h5, h6) { margin-top: 1.25em; font-size: 1em; line-height: 1.5; }

  .threadflow-journal-editor .tiptap :is(ul, ol) {
    margin-top: 1em;
    padding-left: 1.5em;
  }

  .threadflow-journal-editor .tiptap ul { list-style: disc; }
  .threadflow-journal-editor .tiptap ol { list-style: decimal; }
  .threadflow-journal-editor .tiptap li { margin-top: 0.35em; padding-left: 0.25em; }
  .threadflow-journal-editor .tiptap li::marker { color: var(--warning); }
  .threadflow-journal-editor .tiptap li > :is(p, ul, ol) { margin-top: 0.35em; }

  .threadflow-journal-editor .tiptap ul[data-type="taskList"] {
    list-style: none;
    padding-left: 0;
  }

  .threadflow-journal-editor .tiptap ul[data-type="taskList"] ul[data-type="taskList"] {
    margin-top: 0;
    padding-left: 1.5em;
  }

  .threadflow-journal-editor .tiptap ul[data-type="taskList"] li {
    display: flex;
    align-items: flex-start;
    gap: 0.6em;
    margin-top: 0.4em;
    padding-left: 0;
  }

  .threadflow-journal-editor .tiptap ul[data-type="taskList"] li > label {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    height: 1.75em;
    user-select: none;
  }

  .threadflow-journal-editor .tiptap ul[data-type="taskList"] li > div {
    min-width: 0;
    flex: 1 1 auto;
  }

  .threadflow-journal-editor .tiptap ul[data-type="taskList"] li > div > p:first-child {
    margin-top: 0;
  }

  .threadflow-journal-editor .tiptap ul[data-type="taskList"] input[type="checkbox"] {
    display: block;
    width: 15px;
    height: 15px;
    margin: 0;
    cursor: pointer;
    accent-color: var(--warning);
  }

  .threadflow-journal-editor .tiptap ul[data-type="taskList"] li[data-checked="true"] > div {
    color: var(--muted-foreground);
    text-decoration: line-through;
  }

  .threadflow-journal-editor .tiptap blockquote {
    margin-top: 1em;
    border-left: 2px solid var(--border);
    padding-left: 1em;
    color: var(--muted-foreground);
  }

  .threadflow-journal-editor .tiptap code {
    border-radius: 0.25rem;
    background: var(--muted);
    padding: 0.1em 0.3em;
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 0.875em;
  }

  .threadflow-journal-editor .tiptap pre {
    margin-top: 1em;
    overflow-x: auto;
    border-radius: var(--radius);
    background: var(--muted);
    padding: 0.75em 1em;
    font-size: 0.875em;
    line-height: 1.5;
  }

  .threadflow-journal-editor .tiptap pre code { background: none; padding: 0; font-size: inherit; }
  .threadflow-journal-editor .tiptap strong { font-weight: 600; }
  .threadflow-journal-editor .tiptap a {
    color: inherit;
    font-weight: 500;
    text-decoration: underline;
    text-decoration-color: color-mix(in oklab, currentColor 35%, transparent);
  }
  .threadflow-journal-editor .tiptap a:hover { text-decoration-color: currentColor; }
  .threadflow-journal-editor .tiptap hr { margin-top: 2em; border: 0; border-top: 1px solid var(--border); }

  .threadflow-journal-editor .tiptap p.is-editor-empty:first-child::before {
    float: left;
    height: 0;
    color: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
    content: attr(data-placeholder);
    pointer-events: none;
  }

  .threadflow-journal-editor .tiptap ::selection {
    background: color-mix(in oklab, var(--primary) 22%, transparent);
  }
`;

const nativeUserMessageTimestamps = new Map<string, { threadId: string; createdAt: number }>();
const nativeUserMessageTimestampRowsByThread = new Map<string, Set<string>>();

function replaceNativeUserMessageTimestamps(threadId: string, messages: readonly UserMessageTimestamp[]): void {
  const previousRowIds = nativeUserMessageTimestampRowsByThread.get(threadId);
  if (previousRowIds !== undefined) {
    for (const rowId of previousRowIds) {
      if (nativeUserMessageTimestamps.get(rowId)?.threadId === threadId) {
        nativeUserMessageTimestamps.delete(rowId);
      }
    }
  }

  const nextRowIds = new Set<string>();
  for (const message of messages) {
    for (const rowId of message.rowIds) {
      const existing = nativeUserMessageTimestamps.get(rowId);
      if (existing === undefined || existing.threadId !== threadId || existing.createdAt <= message.createdAt) {
        nativeUserMessageTimestamps.set(rowId, { threadId, createdAt: message.createdAt });
      }
      nextRowIds.add(rowId);
    }
  }
  nativeUserMessageTimestampRowsByThread.set(threadId, nextRowIds);
  syncNativeUserMessages();
}

function clearNativeUserMessageTimestamps(threadId: string): void {
  const rowIds = nativeUserMessageTimestampRowsByThread.get(threadId);
  nativeUserMessageTimestampRowsByThread.delete(threadId);
  if (rowIds !== undefined) {
    for (const rowId of rowIds) {
      if (nativeUserMessageTimestamps.get(rowId)?.threadId === threadId) {
        nativeUserMessageTimestamps.delete(rowId);
      }
    }
  }
  syncNativeUserMessages();
}

function createNativeUserBubbleTail(): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const tail = document.createElementNS(namespace, "svg");
  tail.setAttribute(MESSAGE_BUBBLE_TAIL_ATTRIBUTE, "");
  tail.setAttribute("viewBox", "0 0 14 13");
  tail.setAttribute("width", "14");
  tail.setAttribute("height", "13");
  tail.setAttribute("fill", "none");
  tail.setAttribute("aria-hidden", "true");

  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", MESSAGE_BUBBLE_TAIL_PATH);
  path.setAttribute("fill", "currentColor");
  path.setAttribute("stroke", "currentColor");
  tail.append(path);
  return tail;
}

function syncNativeUserMessages(): void {
  const userMessages = Array.from(document.querySelectorAll<HTMLElement>(NATIVE_USER_MESSAGE_SELECTOR));
  for (const message of userMessages) {
    const bubble = message.querySelector<HTMLElement>(NATIVE_USER_BUBBLE_RELATIVE_SELECTOR);
    const isNudgerMessage = message.querySelector(NATIVE_STEER_HEADER_SELECTOR) !== null
      && bubble !== null
      && isThreadNudgerMessageText(bubble.textContent ?? "");
    if (isNudgerMessage) message.setAttribute(NUDGER_MESSAGE_ATTRIBUTE, "");
    else message.removeAttribute(NUDGER_MESSAGE_ATTRIBUTE);
  }

  const desiredBubbles = new Set<HTMLElement>();
  const bottomBubbles = new Set<HTMLElement>();
  const desiredTimestampHosts = new Map<HTMLElement, number>();
  const rowSelector = [
    ":scope > [data-timeline-row-id]",
    ":scope > [data-timeline-virtual-spacer] > [data-timeline-row-id]",
  ].join(", ");

  const timelineLists = Array.from(document.querySelectorAll<HTMLElement>("[data-timeline-row-list]"));
  for (const list of timelineLists) {
    const rows = Array.from(list.querySelectorAll<HTMLElement>(rowSelector));
    for (const [index, row] of rows.entries()) {
      const userMessage = row.querySelector<HTMLElement>(NATIVE_USER_MESSAGE_SELECTOR);
      if (userMessage === null || userMessage.hasAttribute(NUDGER_MESSAGE_ATTRIBUTE)) continue;
      const nextRow = rows[index + 1];
      const nextUserMessage = nextRow?.querySelector<HTMLElement>(NATIVE_USER_MESSAGE_SELECTOR);
      if (nextUserMessage != null && !nextUserMessage.hasAttribute(NUDGER_MESSAGE_ATTRIBUTE)) continue;

      const bubble = row.querySelector<HTMLElement>(NATIVE_USER_BUBBLE_SELECTOR);
      if (bubble !== null) {
        desiredBubbles.add(bubble);
        if (index === rows.length - 1) bottomBubbles.add(bubble);
      }

      const timestampRow = userMessage.closest<HTMLElement>("[data-timeline-row-id]");
      const timestampRowId = timestampRow?.dataset.timelineRowId;
      const timestamp = timestampRowId === undefined
        ? undefined
        : nativeUserMessageTimestamps.get(timestampRowId);
      if (timestamp !== undefined) desiredTimestampHosts.set(userMessage, timestamp.createdAt);
    }
  }

  const existingTails = Array.from(
    document.querySelectorAll<SVGSVGElement>(`[${MESSAGE_BUBBLE_TAIL_ATTRIBUTE}]`),
  );
  for (const tail of existingTails) {
    const bubble = tail.parentElement;
    if (bubble === null || !desiredBubbles.has(bubble)) tail.remove();
  }

  for (const bubble of desiredBubbles) {
    if (bubble.querySelector(`:scope > [${MESSAGE_BUBBLE_TAIL_ATTRIBUTE}]`) === null) {
      bubble.append(createNativeUserBubbleTail());
    }
  }

  const existingSpacers = Array.from(
    document.querySelectorAll<HTMLElement>(`[${MESSAGE_BUBBLE_TAIL_SPACER_ATTRIBUTE}]`),
  );
  for (const bubble of existingSpacers) {
    if (!bottomBubbles.has(bubble)) bubble.removeAttribute(MESSAGE_BUBBLE_TAIL_SPACER_ATTRIBUTE);
  }
  for (const bubble of bottomBubbles) bubble.setAttribute(MESSAGE_BUBBLE_TAIL_SPACER_ATTRIBUTE, "");

  const existingTimestampHosts = Array.from(
    document.querySelectorAll<HTMLElement>(`[${MESSAGE_TIMESTAMP_HOST_ATTRIBUTE}]`),
  );
  for (const host of existingTimestampHosts) {
    if (desiredTimestampHosts.has(host)) continue;
    host.removeAttribute(MESSAGE_TIMESTAMP_HOST_ATTRIBUTE);
    host.querySelector(`:scope > [${MESSAGE_TIMESTAMP_ATTRIBUTE}]`)?.remove();
  }
  for (const [host, createdAt] of desiredTimestampHosts) {
    host.setAttribute(MESSAGE_TIMESTAMP_HOST_ATTRIBUTE, "");
    let timestamp = host.querySelector<HTMLTimeElement>(`:scope > [${MESSAGE_TIMESTAMP_ATTRIBUTE}]`);
    if (timestamp === null) {
      timestamp = document.createElement("time");
      timestamp.setAttribute(MESSAGE_TIMESTAMP_ATTRIBUTE, "");
      host.append(timestamp);
    }
    const date = new Date(createdAt);
    timestamp.dateTime = date.toISOString();
    timestamp.textContent = formatUserMessageTimestamp(createdAt);
  }
}

const NATIVE_COMPOSER_CSS = `
  [data-thread-window]:has([data-threadflow-summary-open="true"]) [data-timeline-row-list="top-level"] {
    opacity: 0 !important;
    pointer-events: none !important;
  }

  html[data-threadflow-composer-scope="new-thread"] :has(> [data-app-composer-role="primary"]) {
    min-height: 100%;
    justify-content: flex-end;
    padding-top: 1rem !important;
  }

  [data-follow-up-composer-footer] {
    position: relative !important;
    height: 0 !important;
    min-height: 0 !important;
    max-height: 0 !important;
    margin-top: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
  }

  [data-follow-up-composer-footer] > :first-child {
    display: none !important;
  }

  [data-follow-up-composer-footer] > :last-child {
    position: absolute !important;
    right: 3rem !important;
    bottom: 0.625rem !important;
    z-index: 4 !important;
    gap: 0.375rem !important;
  }

  [data-follow-up-composer-footer] button[aria-label="Permission mode"] {
    display: inline-grid !important;
    width: 1.75rem !important;
    min-width: 1.75rem !important;
    height: 1.75rem !important;
    place-items: center !important;
    align-content: center !important;
    justify-content: center !important;
    padding: 0 !important;
  }

  [data-follow-up-composer-footer] button[aria-label="Permission mode"] > * {
    display: none !important;
  }

  [data-follow-up-composer-footer] button[aria-label="Permission mode"]::before {
    display: grid;
    width: 1.125rem;
    height: 1.125rem;
    place-items: center;
    border: 1.5px solid currentColor;
    border-radius: 9999px;
    content: "✓";
    font-size: 0.6875rem;
    font-weight: 700;
    line-height: 1;
    margin-inline: auto;
  }

  [data-promptbox-standard-actions] button[aria-label="Start voice input"] {
    display: none !important;
  }

  [data-promptbox-submit-action]:not([aria-label="Stop run"]):not([aria-label="Start voice input"]) svg * {
    stroke-width: 2.25 !important;
  }
`;

const INSTANT_SIDEBAR_CSS = `
  [data-sidebar],
  [data-sidebar] *,
  [data-slot^="sidebar-"],
  [data-slot^="sidebar-"] * {
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    transition-delay: 0s !important;
    transition-duration: 0s !important;
    scroll-behavior: auto !important;
  }
`;

type KeyboardFocusMode = "sidebar" | "chat";

function getKeyboardFocusMode(): KeyboardFocusMode {
  return document.documentElement.dataset.threadflowFocusMode === "sidebar" ? "sidebar" : "chat";
}

function setKeyboardFocusMode(mode: KeyboardFocusMode) {
  if (getKeyboardFocusMode() === mode) return;
  document.documentElement.dataset.threadflowFocusMode = mode;
  window.dispatchEvent(new CustomEvent<KeyboardFocusMode>(KEYBOARD_FOCUS_MODE_EVENT, { detail: mode }));
}

function NativeSideChatPanel({ threadId: sourceThreadId, params }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const requestedThreadId = typeof params === "object"
    && params !== null
    && !Array.isArray(params)
    && typeof params.childThreadId === "string"
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
    void rpc.call("create_side_chat", { sourceThreadId })
      .then((result) => { if (!cancelled) setThreadId(result.thread.id); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [requestedThreadId, rpc, sourceThreadId]);

  useEffect(() => {
    if (threadId === null) {
      setHandoffPending(false);
      return;
    }
    let cancelled = false;
    void rpc.call("handoff_status", { threadId }).then(
      ({ pending }) => { if (!cancelled) setHandoffPending(pending); },
      () => { if (!cancelled) setHandoffPending(false); },
    );
    return () => { cancelled = true; };
  }, [rpc, threadId]);

  useRealtime(HANDOFFS_CHANGED_CHANNEL, (event) => {
    if (typeof event !== "object" || event === null || threadId === null) return;
    const update = event as { threadId?: unknown; status?: unknown; message?: unknown };
    if (update.threadId !== threadId || update.status !== "sent" && update.status !== "failed") return;
    setHandoffPending(false);
    if (update.status === "sent") toast.success("Handoff sent to the main agent");
    else toast.error(typeof update.message === "string" ? update.message : "Handoff failed");
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

  if (error !== null) return <div className="p-4 text-sm text-destructive">{error}</div>;
  if (threadId === null) return <div className="p-4 text-sm text-muted-foreground">Starting side chat…</div>;
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

function relativeTime(timestamp: number): string {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
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

function threadAccent(title: string, createdAt: number): { color: string } {
  const seed = `${title}\u0000${createdAt}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  const unsignedHash = hash >>> 0;
  const hue = unsignedHash % 360;
  return {
    color: `light-dark(oklch(52% 0.22 ${hue}), oklch(76% 0.18 ${hue}))`,
  };
}

function PullRequestLink({ pullRequest }: { pullRequest: PluginSidebarPullRequest }) {
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
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-3">
        <path d="M6 4h6v6M12 4 5 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </UrlLink>
  );
}

type WorktreeChanges = {
  baseBranch: string;
  fileCount: number;
  additions: number;
  deletions: number;
};

function WorktreeChangesBadge({ changes }: { changes: WorktreeChanges }) {
  const filesLabel = `${changes.fileCount} ${changes.fileCount === 1 ? "file" : "files"}`;
  const detail = `${filesLabel} differ from ${changes.baseBranch}: ${changes.additions} additions, ${changes.deletions} deletions`;
  return (
    <span
      className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground"
      title={detail}
      aria-label={detail}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-3">
        <path d="M3 4.5h3M4.5 3v3M10 4.5h3M10 11.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span>{filesLabel}</span>
      <span>+{changes.additions}</span>
      <span>−{changes.deletions}</span>
    </span>
  );
}

function ChatAccentHeader({ target, compact = false }: { target: ChatTarget; compact?: boolean }) {
  const rpc = useRpc<typeof rpcContract>();
  const sourceThreadId = target.sourceThreadId ?? target.id;
  const { pullRequest } = experimental_useSidebarThreadPullRequest(sourceThreadId);
  const [worktreeChanges, setWorktreeChanges] = useState<WorktreeChanges | null>(null);
  const [checks, setChecks] = useState<{
    state: "failing" | "no_checks" | "passing" | "pending" | "unknown";
    failedCount: number;
    pendingCount: number;
    totalCount: number;
  } | null | undefined>(undefined);
  const accent = threadAccent(target.accentTitle ?? target.title, target.accentCreatedAt ?? target.createdAt);
  const project = target.project ?? "Personal";
  const label = target.sourceThreadId !== undefined && target.title === "Review"
    ? "Review"
    : project === "usebogi.com"
      ? null
      : project;
  const compactLabel = target.worktree;

  useEffect(() => {
    if (pullRequest === null) {
      setChecks(undefined);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const result = await rpc.call("pull_request_checks", { threadId: sourceThreadId });
        if (!cancelled) setChecks(result.checks);
      } catch {
        if (!cancelled) setChecks(null);
      }
    };
    setChecks(undefined);
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pullRequest?.number, rpc, sourceThreadId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await rpc.call("worktree_changes", { threadId: sourceThreadId });
        if (!cancelled) setWorktreeChanges(result.changes);
      } catch {
        if (!cancelled) setWorktreeChanges(null);
      }
    };
    setWorktreeChanges(null);
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [rpc, sourceThreadId]);

  const checksLabel = pullRequest?.state === "merged"
    ? null
    : checks === undefined
    ? "Checking…"
    : checks === null || checks.state === "unknown"
      ? "Checks unknown"
      : checks.state === "failing"
        ? `${checks.failedCount || "Some"} failed`
        : checks.state === "pending"
          ? `${checks.pendingCount || "Some"} pending`
          : null;

  if (!compact && label === null && pullRequest === null && worktreeChanges === null) {
    return <div className="h-1 shrink-0" style={{ backgroundColor: accent.color }} aria-hidden="true" />;
  }
  return (
    <div className={compact
      ? "flex h-7 min-w-0 items-center gap-1.5 text-[10px] font-medium"
      : "flex shrink-0 items-center gap-2 px-3 py-1.5 text-[11px] font-medium"} style={{ color: accent.color }}>
      {compact ? null : label === null ? null : (
        <>
          <span className="h-px w-3" style={{ backgroundColor: accent.color }} aria-hidden="true" />
          <span>{label}</span>
        </>
      )}
      {compact && compactLabel !== null ? (
        <span className={target.worktree !== null ? "max-w-52 truncate font-mono" : "max-w-20 truncate"} title={compactLabel}>
          {compactLabel}
        </span>
      ) : null}
      {compact ? null : <span className={label === null ? "h-1 flex-1" : "h-px flex-1"} style={{ backgroundColor: accent.color }} aria-hidden="true" />}
      {worktreeChanges === null ? null : <WorktreeChangesBadge changes={worktreeChanges} />}
      {pullRequest === null || checksLabel === null ? null : (
        <span className={`shrink-0 text-[10px] font-medium ${checks?.state === "failing" ? "text-red-500" : checks?.state === "pending" ? "text-amber-500" : "text-muted-foreground"}`}>
          {checksLabel}
        </span>
      )}
      {pullRequest === null ? null : (
        <PullRequestLink pullRequest={pullRequest} />
      )}
    </div>
  );
}

function NativeThreadHeader({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [target, setTarget] = useState<ChatTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    void rpc.call("thread_context", { threadId })
      .then((result) => { if (!cancelled) setTarget(result.target); })
      .catch(() => { if (!cancelled) setTarget(null); });
    return () => { cancelled = true; };
  }, [rpc, threadId]);

  if (target === null) return null;
  return (
    <div className={isCompactViewport ? "max-w-28 overflow-hidden" : "max-w-[38rem] overflow-hidden"}>
      <ChatAccentHeader target={target} compact />
    </div>
  );
}

type ChatSummaryData = {
  threadId: string;
  sourceUpdatedAt: number;
  lastUserMessage: string;
  summary: string;
  followUps?: string[];
  dismissed: boolean;
};

function NativeChatSummary({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const anchorRef = useRef<HTMLDivElement>(null);
  const followUpButtonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const viewerIdRef = useRef(`${VIEWER_CLIENT_ID}-${Math.random().toString(36).slice(2)}`);
  const [summary, setSummary] = useState<ChatSummaryData | null>(null);
  const [selectedFollowUp, setSelectedFollowUp] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await rpc.call("chat_summary", { threadId });
      setSummary(result.summary);
    } catch {
      setSummary(null);
    }
  }, [rpc, threadId]);

  useEffect(() => { void load(); }, [load]);
  useRealtime(SUMMARIES_CHANGED_CHANNEL, (event) => {
    if (typeof event === "object" && event !== null && (event as { threadId?: unknown }).threadId === threadId) void load();
  });
  useEffect(() => {
    const clientId = viewerIdRef.current;
    void rpc.call("set_viewing_thread", { clientId, threadId });
    return () => { void rpc.call("set_viewing_thread", { clientId, threadId: null }); };
  }, [rpc, threadId]);
  useEffect(() => {
    setSelectedFollowUp(0);
    setError(null);
  }, [summary?.sourceUpdatedAt, threadId]);

  const setDismissed = useCallback((dismissed: boolean) => {
    setSummary((current) => current === null ? null : { ...current, dismissed });
    void rpc.call("set_chat_summary_dismissed", { threadId, dismissed });
  }, [rpc, threadId]);

  useEffect(() => {
    const dismiss = (event: Event) => {
      if ((event as CustomEvent<unknown>).detail === threadId) setDismissed(true);
    };
    window.addEventListener(DISMISS_CHAT_SUMMARY_EVENT, dismiss);
    return () => window.removeEventListener(DISMISS_CHAT_SUMMARY_EVENT, dismiss);
  }, [setDismissed, threadId]);

  const followUps = summary?.followUps ?? [];
  const sendFollowUp = useCallback(async (index = selectedFollowUp) => {
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
  }, [followUps, rpc, selectedFollowUp, sending, threadId]);

  useEffect(() => {
    if (summary?.dismissed !== false || followUps.length === 0) return;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (activeElement !== null && activeElement.closest("[data-threadflow-row]") !== null) return;
    const frame = window.requestAnimationFrame(() => followUpButtonsRef.current[0]?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [followUps.length, summary?.dismissed, summary?.sourceUpdatedAt]);

  return (
    <div
      ref={anchorRef}
      className="relative"
      data-threadflow-summary-open={summary?.dismissed === false ? "true" : undefined}
      data-threadflow-summary-thread-id={threadId}
    >
      {summary?.dismissed === true ? (
        <div className="flex justify-end px-1 pb-1">
          <button type="button" onClick={() => setDismissed(false)} className="text-[10px] text-muted-foreground/30 hover:text-muted-foreground">
            Show TL;DR
          </button>
        </div>
      ) : null}
      {summary?.dismissed === false ? (
        <div
          data-bb-plugin="threadflow"
          className="relative z-30 rounded-xl border border-border bg-background p-4 text-foreground shadow-lg"
          aria-label="Chat summary"
          onKeyDown={(event) => {
            if (
              event.metaKey
              || event.ctrlKey
              || event.altKey
              || event.shiftKey
              || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
              || followUps.length === 0
            ) return;
            event.preventDefault();
            event.stopPropagation();
            const direction = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
            const next = (selectedFollowUp + direction + followUps.length) % followUps.length;
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
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-3">
                <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <div className="flex justify-end pt-3" aria-label="Your message">
              <div className="relative max-w-[70%] rounded-2xl bg-[var(--surface-recessed-solid)] px-3 py-1.5">
                <div className="max-h-24 overflow-y-auto">
                  <Markdown content={summary.lastUserMessage} className="text-sm font-normal leading-relaxed text-foreground [&_code]:!text-[1em]" />
                </div>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 14 13"
                  fill="none"
                  className="pointer-events-none absolute -bottom-[7px] right-1 z-10 h-[13px] w-[14px] text-[var(--surface-recessed-solid)]"
                >
                  <path d={MESSAGE_BUBBLE_TAIL_PATH} fill="currentColor" stroke="currentColor" />
                </svg>
              </div>
            </div>
            <div className="max-h-32 overflow-y-auto pr-6">
              <Markdown content={summary.summary} className="text-sm font-normal leading-relaxed text-foreground [&_code]:!text-[1em]" />
            </div>
            {followUps.length > 0 ? (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2" aria-label="Suggested follow-ups">
                {followUps.map((followUp, index) => (
                  <button
                    type="button"
                    ref={(button) => { followUpButtonsRef.current[index] = button; }}
                    key={`${index}:${followUp}`}
                    tabIndex={selectedFollowUp === index ? 0 : -1}
                    disabled={sending}
                    onMouseEnter={() => setSelectedFollowUp(index)}
                    onFocus={() => setSelectedFollowUp(index)}
                    onClick={() => {
                      void sendFollowUp(index);
                    }}
                    className={selectedFollowUp === index
                      ? "rounded-md bg-muted px-3 py-2 text-left text-sm text-foreground outline outline-2 outline-dotted outline-blue-500 outline-offset-2"
                      : "rounded-md bg-muted/40 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"}
                  >
                    {followUp}
                  </button>
                ))}
              </div>
            ) : null}
            {error === null ? null : <p className="text-xs text-destructive">{error}</p>}
            <p className="text-[10px] text-muted-foreground/40">{sending ? "Sending…" : "↑/↓ to choose · Enter to send"}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function useThreadCommand(threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const actions = experimental_useSidebarThreadActions();

  return useCallback(async (key: string, shiftKey: boolean) => {
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
    if (shiftKey && key === "l") {
      await rpc.call("send_message", { threadId, message: ASK_LINUS_PROMPT });
      return true;
    }
    if (shiftKey && key === "t") {
      const result = await rpc.call("toggle_chat_summary", { threadId });
      if (result.status === "started") toast.success("Generating TLDR…");
      else if (result.status === "busy") toast.success("TLDR is already generating");
      return true;
    }
    if (shiftKey && key === "a") {
      await rpc.call("toggle_archived", { id: threadId });
      return true;
    }
    return false;
  }, [actions, navigate, rpc, threadId]);
}

function PromptAutocomplete() {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const view = useComposerView();
  const anchorRef = useRef<HTMLDivElement>(null);
  const previousDraftRef = useRef(view.draft.text);
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
    return () => { cancelled = true; };
  }, [rpc]);

  useEffect(() => {
    const previous = previousDraftRef.current.trim();
    previousDraftRef.current = view.draft.text;
    if (previous === "" || !view.draft.isEmpty) return;
    setHistory((current) => [previous, ...current.filter((prompt) => prompt.toLocaleLowerCase() !== previous.toLocaleLowerCase())].slice(0, 100));
  }, [view.draft.isEmpty, view.draft.text]);

  const typed = view.draft.text;
  const normalizedTyped = typed.toLocaleLowerCase();
  const suggestion = typed === "" || typed.includes("\n")
    ? null
    : history.find((prompt) => prompt.length > typed.length && prompt.toLocaleLowerCase().startsWith(normalizedTyped)) ?? null;
  const accept = useCallback(() => {
    if (suggestion === null) return;
    composer.setText(suggestion);
    composer.focus();
  }, [composer, suggestion]);

  useEffect(() => {
    if (suggestion === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target === null || target.closest("input, textarea, [contenteditable='true']") === null) return;
      const anchorRect = anchorRef.current?.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      if (anchorRect === undefined || targetRect.right < anchorRect.left || targetRect.left > anchorRect.right) return;
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
          <button type="button" onClick={accept} className="pointer-events-auto w-0 min-w-0 flex-1 overflow-hidden text-left text-muted-foreground/50 hover:text-muted-foreground">
            <span className="block truncate">
              <span className="text-muted-foreground/80">{typed}</span>{suggestion.slice(typed.length)}
            </span>
          </button>
          <kbd className="ml-auto shrink-0 rounded border border-border px-1 py-0.5 font-mono text-[9px] text-muted-foreground/50">Tab</kbd>
        </div>
      )}
    </div>
  );
}

function NewThreadComposerBridge() {
  useEffect(() => {
    document.documentElement.dataset.threadflowComposerScope = "new-thread";
    return () => {
      if (document.documentElement.dataset.threadflowComposerScope === "new-thread") {
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
      const addedUserMessage = records.some((record) => Array.from(record.addedNodes).some((node) =>
        node instanceof Element
        && (node.matches(NATIVE_USER_MESSAGE_SELECTOR) || node.querySelector(NATIVE_USER_MESSAGE_SELECTOR) !== null)
      ));
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

function ThreadComposerBridge({ threadId, scopeKind }: {
  threadId: string;
  scopeKind: "thread" | "side-chat";
}) {
  const composer = useComposer();
  const view = useComposerView();
  const context = useBbContext();
  const bridgeRef = useRef<HTMLDivElement>(null);
  const wasSubmitting = useRef(view.run.isSubmitting);
  const wasDraftEmpty = useRef(view.draft.isEmpty);
  const runThreadCommand = useThreadCommand(threadId);

  useEffect(() => {
    const typeInChat = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== "object" || detail === null) return;
      const { threadId, text } = detail as Partial<TypeInChatDetail>;
      if (typeof threadId !== "string" || typeof text !== "string" || text.length !== 1) return;
      const composerThreadId = composer.scope.kind === "thread"
        ? composer.scope.threadId
        : composer.scope.kind === "side-chat"
          ? composer.scope.childThreadId
          : null;
      if (composerThreadId !== threadId) return;
      composer.updateText((current) => `${current}${text}`);
      composer.focus();
    };
    window.addEventListener(TYPE_IN_CHAT_EVENT, typeInChat);
    return () => window.removeEventListener(TYPE_IN_CHAT_EVENT, typeInChat);
  }, [composer]);
  useEffect(() => {
    if (wasSubmitting.current && !view.run.isSubmitting) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.dispatchEvent(new CustomEvent(RETURN_TO_SIDEBAR_EVENT, { detail: threadId }));
    }
    wasSubmitting.current = view.run.isSubmitting;
  }, [threadId, view.run.isSubmitting]);
  useEffect(() => {
    const sentDraft = !wasDraftEmpty.current && view.draft.isEmpty;
    wasDraftEmpty.current = view.draft.isEmpty;
    if (!sentDraft) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.dispatchEvent(new CustomEvent(RETURN_TO_SIDEBAR_EVENT, { detail: threadId }));
  }, [threadId, view.draft.isEmpty]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (scopeKind === "thread" && context.threadId !== threadId) return;
      const bridge = bridgeRef.current;
      const target = event.target instanceof Node ? event.target : null;
      let pane = bridge?.parentElement ?? null;
      while (pane !== null && pane !== document.body) {
        const rect = pane.getBoundingClientRect();
        if (rect.height >= window.innerHeight * 0.45 && rect.width >= (bridge?.getBoundingClientRect().width ?? 0) * 0.95) break;
        pane = pane.parentElement;
      }
      if (target !== null && target !== document.body && pane !== null && !pane.contains(target)) return;
      if (scopeKind === "side-chat" && (target === null || target === document.body || pane === null)) return;
      if (!event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLocaleLowerCase();
      if (event.shiftKey && ["e", "l", "a"].includes(key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void runThreadCommand(key, event.shiftKey).catch((cause) => toast.error(cause instanceof Error ? cause.message : String(cause)));
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [context.threadId, runThreadCommand, scopeKind, threadId]);
  return (
    <div ref={bridgeRef}>
      <NativeUserMessageTimestampBridge threadId={threadId} />
      <PromptAutocomplete />
      <NativeChatSummary threadId={threadId} />
    </div>
  );
}

function ComposerBridge() {
  const view = useComposerView();
  if (view.scope.kind === "new-thread") return <NewThreadComposerBridge />;
  if (view.scope.kind === "thread") {
    return <ThreadComposerBridge threadId={view.scope.threadId} scopeKind="thread" />;
  }
  if (view.scope.kind === "side-chat" && view.scope.childThreadId !== null) {
    return <ThreadComposerBridge threadId={view.scope.childThreadId} scopeKind="side-chat" />;
  }
  return null;
}

function pullRequestColor(attention: string): string {
  if (attention === "ready_to_merge") return "border-green-500/40 bg-green-500/10 text-green-500";
  if (["blocked", "changes_requested", "checks_failed", "conflicts"].includes(attention)) {
    return "border-red-500/40 bg-red-500/10 text-red-500";
  }
  if (["checks_pending", "review_requested"].includes(attention)) {
    return "border-amber-500/40 bg-amber-500/10 text-amber-500";
  }
  if (attention === "merged") return "border-violet-500/40 bg-violet-500/10 text-violet-500";
  return "border-border bg-muted text-muted-foreground";
}

function PullRequestProbe({
  threadId,
  onChange,
}: {
  threadId: string;
  onChange: (threadId: string, pullRequest: PluginSidebarPullRequest | null) => void;
}) {
  const { isLoading, pullRequest } = experimental_useSidebarThreadPullRequest(threadId);
  useEffect(() => {
    if (!isLoading) onChange(threadId, pullRequest);
  }, [isLoading, onChange, pullRequest, threadId]);
  return null;
}

function groupSidebarThreads(
  threads: readonly NativeThread[],
  pullRequests: Readonly<Record<string, PluginSidebarPullRequest | null>>,
): Array<readonly [string, NativeThread[]]> {
  const working: NativeThread[] = [];
  const waiting: NativeThread[] = [];
  const needsYou: NativeThread[] = [];
  const inReview: NativeThread[] = [];
  for (const thread of threads) {
    const state = classifyThreadListState(thread);
    if (state === "working") {
      working.push(thread);
    } else if (state === "waiting") {
      waiting.push(thread);
    } else if (pullRequests[thread.id]?.state === "open" || pullRequests[thread.id]?.state === "draft") {
      inReview.push(thread);
    } else {
      needsYou.push(thread);
    }
  }
  const groups: Array<readonly [string, NativeThread[]]> = [
    ["Needs you", needsYou],
  ];
  if (waiting.length > 0) groups.push(["Waiting", waiting]);
  if (inReview.length > 0) groups.push(["In review", inReview]);
  groups.push(["Working", working]);
  return groups;
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
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-50" aria-hidden="true" />
      <span className="relative inline-flex size-2 rounded-full bg-emerald-500" aria-hidden="true" />
    </span>
  );
}

function ThreadBrandMark({ brand }: { brand: ThreadTitleBrand }) {
  const label = brand === "bb" ? "BB" : "Bogi";
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex size-3 shrink-0 items-center justify-center">
      {brand === "bb" ? (
        <img src={BB_LOGO_DATA_URL} alt="" className="size-3 rounded-[2px]" />
      ) : (
        <svg aria-hidden="true" viewBox="0 0 300 326" fill="none" className="size-3">
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
      {brandedTitle.brand === null ? null : <ThreadBrandMark brand={brandedTitle.brand} />}
      <span className="min-w-0 truncate">{brandedTitle.title}</span>
    </>
  );
}

function SidebarThreadRow({
  thread,
  backgroundCommands,
  pullRequest,
  shortcutNumber,
  selectedThreadId,
  onOpen,
  onOpenSideChat,
  onCloseSideChat,
  onRename,
  showWorkingDuration,
}: {
  thread: NativeThread;
  backgroundCommands: number;
  pullRequest: PluginSidebarPullRequest | null;
  shortcutNumber: number;
  selectedThreadId: string | null;
  onOpen: (thread: NativeThread) => void;
  onOpenSideChat: (sideChat: NativeSideChat) => void;
  onCloseSideChat: (sideChat: NativeSideChat) => Promise<void>;
  onRename: (thread: NativeThread, title: string) => Promise<void>;
  showWorkingDuration: boolean;
}) {
  const { splitProps } = experimental_useSidebarThreadSplit(thread.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title);
  const [saving, setSaving] = useState(false);
  const selected = selectedThreadId === thread.id || thread.sideChats.some((sideChat) => sideChat.id === selectedThreadId);

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
      {...splitProps}
      role="button"
      tabIndex={0}
      data-threadflow-row
      data-sidebar-thread-shortcut-target=""
      data-sidebar-thread-id={thread.id}
      data-thread-id={thread.id}
      aria-current={selected ? "true" : undefined}
      onClick={() => onOpen(thread)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(thread);
        }
      }}
      className={selected
        ? "group cursor-pointer rounded-md bg-muted/60 px-2 py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-muted-foreground/40"
        : "group cursor-pointer rounded-md px-2 py-1.5 outline-none hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-muted-foreground/40"}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <kbd className="shrink-0 font-mono text-[9px] text-muted-foreground">{shortcutNumber}</kbd>
        <BackgroundCommandIndicator count={backgroundCommands} />
        <span
          className="flex min-w-0 flex-1 items-center gap-1 text-xs font-normal text-foreground"
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
            dateTime={new Date(thread.updatedAt).toISOString()}
          >
            {showWorkingDuration ? elapsedTime(thread.updatedAt) : relativeTime(thread.updatedAt)}
          </time>
        </span>
        {pullRequest === null ? null : <PullRequestLink pullRequest={pullRequest} />}
      </div>
      {thread.sideChats.length > 0 ? (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border/60 pl-1.5">
          {thread.sideChats.map((sideChat) => (
            <div
              key={sideChat.id}
              role="button"
              tabIndex={0}
              data-threadflow-row
              data-thread-id={sideChat.id}
              data-side-chat-id={sideChat.id}
              data-source-thread-id={sideChat.sourceThreadId}
              onClick={(event) => { event.stopPropagation(); onOpenSideChat(sideChat); }}
              onKeyDown={(event) => {
                if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  onOpenSideChat(sideChat);
                }
              }}
              className={selectedThreadId === sideChat.id
                ? "flex w-full items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-left text-[10px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-muted-foreground/40"
                : "flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-[10px] text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-1 focus-visible:ring-muted-foreground/40"}
            >
              <span className="flex min-w-0 flex-1 items-center gap-1">
                <ThreadTitleContent title={sideChat.title} />
              </span>
              <button
                type="button"
                aria-label={`Close ${sideChat.title}`}
                title="Close side chat"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void onCloseSideChat(sideChat);
                }}
                className="shrink-0 rounded p-0.5 opacity-40 hover:bg-background hover:opacity-100"
              >
                <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-3">
                  <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      ) : null}
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

function JournalSidebarNavigation({
  items,
  activeItemId,
  experimental_activate: activate,
}: ExperimentalSidebarNavigationProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [threads, setThreads] = useState<NativeThread[]>([]);
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null);
  const journalItem = items.find((item) => item.action.kind === "open-plugin-panel"
    && item.action.pluginId === "threadflow"
    && item.action.panelId === "journal");

  const refresh = useCallback(async () => {
    try {
      const result = await rpc.call("threads", { scope: "recent", query: "" });
      setThreads(result.threads);
    } catch {
      // The journal stays available; only its optional reminder color goes stale.
    }
  }, [rpc]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useRealtime(THREADS_CHANGED_CHANNEL, () => void refresh());
  useEffect(() => {
    const findTarget = () => {
      const nextTarget = document.querySelector<HTMLElement>('[data-testid="app-sidebar-top-reserve-row"]');
      setHeaderTarget((current) => current === nextTarget ? current : nextTarget);
    };
    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (journalItem === undefined || headerTarget === null) return null;
  const isActive = activeItemId === journalItem.id;
  const allWorkIsRunning = threads.length > 0 && threads.every(threadIsWorking);
  const highlight = isActive || allWorkIsRunning;
  const label = allWorkIsRunning && !isActive
    ? "Open Journal — everything is working"
    : "Open Journal";

  return createPortal(
    <button
      type="button"
      {...journalItem.experimental_splitProps}
      aria-label={label}
      title={label}
      aria-current={isActive ? "page" : undefined}
      onClick={() => activate(journalItem.id, { openInSplit: false })}
      className={highlight
        ? "grid size-7 place-items-center rounded-md bg-blue-500/10 text-blue-500 outline-none [app-region:no-drag] [-webkit-app-region:no-drag] hover:bg-blue-500/15 focus-visible:ring-1 focus-visible:ring-blue-500/50"
        : "grid size-7 place-items-center rounded-md text-muted-foreground outline-none [app-region:no-drag] [-webkit-app-region:no-drag] hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-muted-foreground/40"}
    >
      <HugeiconsIcon icon={File01Icon} className="size-4" aria-hidden />
    </button>,
    headerTarget,
  );
}

function useJournalToday(): string {
  const [today, setToday] = useState(() => localJournalDateKey());
  useEffect(() => {
    const timer = window.setInterval(() => setToday(localJournalDateKey()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return today;
}

function journalDateFromSubPath(subPath: string, today: string): string {
  return isJournalDateKey(subPath) ? subPath : today;
}

function JournalHeader({ subPath }: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  const today = useJournalToday();
  const dateKey = journalDateFromSubPath(subPath, today);
  const heading = formatJournalDate(dateKey);
  const goToDate = useCallback((nextDateKey: string) => {
    navigate.toPluginPanel("journal", { subPath: nextDateKey === today ? "" : nextDateKey });
  }, [navigate, today]);

  return (
    <div data-threadflow-journal-header className="flex min-w-0 flex-1 items-center gap-1">
      <button
        type="button"
        aria-label="Previous journal day"
        title="Previous day"
        onClick={() => goToDate(shiftJournalDateKey(dateKey, -1))}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-muted-foreground/40"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" aria-hidden />
      </button>
      <label className="relative min-w-0 cursor-pointer rounded px-1 outline-none focus-within:ring-1 focus-within:ring-muted-foreground/40">
        <span
          className="block truncate text-sm font-semibold tabular-nums text-foreground"
          style={{ fontFamily: '"JetBrains Mono", var(--font-mono, ui-monospace, monospace)' }}
        >
          {heading}
        </span>
        <input
          type="date"
          value={dateKey}
          max={today}
          aria-label="Choose journal date"
          onChange={(event) => {
            if (isJournalDateKey(event.target.value)) goToDate(event.target.value);
          }}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      <button
        type="button"
        disabled={dateKey >= today}
        aria-label="Next journal day"
        title={dateKey >= today ? "This is today" : "Next day"}
        onClick={() => goToDate(shiftJournalDateKey(dateKey, 1))}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-muted-foreground/40 disabled:pointer-events-none disabled:opacity-30"
      >
        <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" aria-hidden />
      </button>
    </div>
  );
}

function JournalDay({ dateKey }: { dateKey: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [content, setContent] = useState("");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const desiredContentRef = useRef("");
  const savedContentRef = useRef("");
  const readyRef = useRef(false);
  const mountedRef = useRef(true);
  const saveInFlightRef = useRef(false);
  const saveAgainRef = useRef(false);
  const loadSequenceRef = useRef(0);

  const load = useCallback(async () => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    readyRef.current = false;
    setReady(false);
    setLoadError(null);
    try {
      const result = await rpc.call("journal_entry", { dateKey });
      if (!mountedRef.current || loadSequenceRef.current !== sequence) return;
      const nextContent = result.content ?? "";
      desiredContentRef.current = nextContent;
      savedContentRef.current = nextContent;
      readyRef.current = true;
      setContent(nextContent);
      setSaveError(false);
      setReady(true);
    } catch (cause) {
      if (!mountedRef.current || loadSequenceRef.current !== sequence) return;
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [dateKey, rpc]);

  const flush = useCallback(async () => {
    if (!readyRef.current) return;
    if (saveInFlightRef.current) {
      saveAgainRef.current = true;
      return;
    }
    saveInFlightRef.current = true;
    try {
      do {
        saveAgainRef.current = false;
        const nextContent = desiredContentRef.current;
        if (nextContent === savedContentRef.current) break;
        await rpc.call("save_journal_entry", { dateKey, content: nextContent });
        savedContentRef.current = nextContent;
      } while (saveAgainRef.current);
      if (mountedRef.current) setSaveError(false);
    } catch {
      if (mountedRef.current) setSaveError(true);
    } finally {
      saveInFlightRef.current = false;
    }
  }, [dateKey, rpc]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      loadSequenceRef.current += 1;
      void flush();
    };
  }, [flush, load]);
  useEffect(() => {
    if (!ready || content === savedContentRef.current) return;
    const timer = window.setTimeout(() => void flush(), 450);
    return () => window.clearTimeout(timer);
  }, [content, flush, ready]);

  const heading = formatJournalDate(dateKey);
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {loadError === null ? (
          <span>Loading…</span>
        ) : (
          <div className="space-y-3 text-center">
            <p>Couldn’t load this journal entry.</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void load()}>Try again</Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 pb-8 pt-2 md:px-10 md:pb-10 md:pt-3">
      <JournalMarkdownEditor
        initialMarkdown={content}
        ariaLabel={`Journal for ${heading}`}
        onMarkdownChange={(nextContent) => {
          desiredContentRef.current = nextContent;
          setContent(nextContent);
        }}
        onBlur={() => void flush()}
      />
      {saveError ? (
        <span role="status" className="mt-2 shrink-0 text-right text-xs text-destructive">
          Couldn’t save
        </span>
      ) : null}
    </main>
  );
}

function JournalPage({ subPath }: PluginNavPanelProps) {
  const today = useJournalToday();
  const dateKey = journalDateFromSubPath(subPath, today);
  return (
    <div className="h-full min-h-0 overflow-hidden bg-background">
      <JournalDay key={dateKey} dateKey={dateKey} />
    </div>
  );
}

type CodexUsage =
  | { status: "ok"; planLabel: string | null; windows: Array<{ label: string; resetsAt: string | null; usedPercent: number }> }
  | { status: "unavailable"; message: string };

function formatUsageReset(resetsAt: string | null): string | null {
  if (resetsAt === null) return null;
  const remainingMs = Date.parse(resetsAt) - Date.now();
  if (!Number.isFinite(remainingMs)) return null;
  if (remainingMs <= 0) return "resetting";
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.ceil(hours / 24)}d`;
}

function localDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatTodayUsage(usedPercent: number): string {
  return `${Math.round(usedPercent)}% today`;
}

function SidebarFooter() {
  const rpc = useRpc<typeof rpcContract>();
  const [usage, setUsage] = useState<CodexUsage | null>(null);
  const [todayUsage, setTodayUsage] = useState<TodayUsageEstimate | null>(null);
  const usageRefreshInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (usageRefreshInFlight.current) return;
    usageRefreshInFlight.current = true;
    try {
      setUsage(await rpc.call("codex_usage", {}));
    } catch {
      setUsage({ status: "unavailable", message: "Codex usage unavailable" });
    } finally {
      usageRefreshInFlight.current = false;
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10 * 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      const now = Date.now();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 0);
      timer = window.setTimeout(() => {
        void refresh();
        schedule();
      }, nextMidnight.getTime() - now + 1_000);
    };
    schedule();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refresh]);

  const weeklyWindow = usage?.status === "ok"
    ? usage.windows.find((window) => /week|7\s*d/i.test(window.label)) ?? usage.windows.at(-1) ?? null
    : null;

  useEffect(() => {
    if (weeklyWindow === null) {
      setTodayUsage(null);
      return;
    }
    const now = Date.now();
    const current: UsageSample = {
      observedAt: now,
      resetsAt: weeklyWindow.resetsAt,
      usedPercent: weeklyWindow.usedPercent,
    };
    try {
      const samples = parseUsageSamples(window.localStorage.getItem(USAGE_SAMPLES_STORAGE_KEY));
      setTodayUsage(calculateTodayUsedPercent({
        samples,
        current,
        dayStartedAt: localDayStart(now),
      }));
      window.localStorage.setItem(
        USAGE_SAMPLES_STORAGE_KEY,
        JSON.stringify(appendUsageSample(samples, current)),
      );
    } catch {
      setTodayUsage(null);
    }
  }, [weeklyWindow]);

  if (weeklyWindow === null) return null;

  const usedPercent = Math.min(100, Math.max(0, weeklyWindow.usedPercent));
  const todayWidth = todayUsage === null ? 0 : Math.min(usedPercent, todayUsage.usedPercent);
  const reset = formatUsageReset(weeklyWindow.resetsAt);

  return (
    <div className="shrink-0 space-y-1.5 px-3.5 py-2">
      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/80">
          <span className="truncate">Usage</span>
          <span className="shrink-0 pl-2">
            {formatTodayUsage(todayUsage?.usedPercent ?? 0)} • {Math.round(100 - usedPercent)}% left
            {reset === null ? "" : ` • ${reset}`}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={`${weeklyWindow.label} usage`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(usedPercent)}
          className="relative h-1 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-foreground/30" style={{ width: `${usedPercent}%` }} />
          {todayUsage === null || todayWidth === 0 ? null : (
            <div
              className="absolute top-0 h-full bg-foreground/65"
              style={{ left: `${usedPercent - todayWidth}%`, width: `${todayWidth}%` }}
              title={formatTodayUsage(todayWidth)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CompactThreadList({ activeThreadId, onNavigate }: PluginThreadListProps) {
  const rpc = useRpc<typeof rpcContract>();
  const { threads: nativeSidebarThreads } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const navigate = useBbNavigate();
  const [threads, setThreads] = useState<NativeThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(activeThreadId);
  const [pullRequests, setPullRequests] = useState<Record<string, PluginSidebarPullRequest | null>>({});
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const keepSidebarFocusRef = useRef(false);
  const sideChatPanelTimersRef = useRef<Set<number>>(new Set());
  const previousPullRequestNumbersRef = useRef(new Map<string, number | null>());
  const startedReviewKeysRef = useRef(new Set<string>());
  const reviewsInFlightRef = useRef(new Set<string>());
  const runThreadCommand = useThreadCommand(selectedThreadId);

  const clearSideChatPanelTimers = useCallback(() => {
    for (const timer of sideChatPanelTimersRef.current) window.clearTimeout(timer);
    sideChatPanelTimersRef.current.clear();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await rpc.call("threads", { scope: "recent", query: "" });
      setThreads(result.threads);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => clearSideChatPanelTimers, [clearSideChatPanelTimers]);
  useRealtime(THREADS_CHANGED_CHANNEL, () => void refresh());
  useEffect(() => {
    if (activeThreadId !== null) setSelectedThreadId(activeThreadId);
  }, [activeThreadId]);

  const recordPullRequest = useCallback((threadId: string, pullRequest: PluginSidebarPullRequest | null) => {
    setPullRequests((current) => ({ ...current, [threadId]: pullRequest }));
    const number = pullRequest?.number ?? null;
    const previousNumber = previousPullRequestNumbersRef.current.get(threadId);
    previousPullRequestNumbersRef.current.set(threadId, number);

    const reviewKey = number === null ? null : `${threadId}:${number}`;
    if (previousNumber === undefined) {
      if (reviewKey !== null) startedReviewKeysRef.current.add(reviewKey);
      return;
    }
    if (
      reviewKey === null
      || previousNumber === number
      || startedReviewKeysRef.current.has(reviewKey)
      || reviewsInFlightRef.current.has(reviewKey)
    ) return;

    startedReviewKeysRef.current.add(reviewKey);
    reviewsInFlightRef.current.add(reviewKey);
    void rpc.call("create_automatic_review", {
      sourceThreadId: threadId,
    }).then(
      ({ status }) => {
        if (status === "started") toast.success(`Review started for PR #${number}`);
      },
      (cause) => {
        startedReviewKeysRef.current.delete(reviewKey);
        previousPullRequestNumbersRef.current.set(threadId, null);
        toast.error(cause instanceof Error ? cause.message : String(cause));
      },
    ).finally(() => reviewsInFlightRef.current.delete(reviewKey));
  }, [rpc]);
  const groups = useMemo(() => groupSidebarThreads(threads, pullRequests), [pullRequests, threads]);
  const flatThreads = groups.flatMap(([, groupThreads]) => groupThreads);
  const nativeThreadById = useMemo(
    () => new Map(nativeSidebarThreads.map((thread) => [thread.id, thread])),
    [nativeSidebarThreads],
  );

  const focusSidebarRow = useCallback((threadId: string | null) => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-threadflow-row]") ?? []);
    const row = rows.find((candidate) => candidate.dataset.threadId === threadId) ?? rows[0];
    setKeyboardFocusMode("sidebar");
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }, []);

  const openThread = useCallback((threadId: string, keepSidebarFocus = false) => {
    clearSideChatPanelTimers();
    keepSidebarFocusRef.current = keepSidebarFocus;
    setKeyboardFocusMode(keepSidebarFocus ? "sidebar" : "chat");
    setSelectedThreadId(threadId);
    actions.open(threadId);
    onNavigate();
    if (keepSidebarFocus) {
      window.requestAnimationFrame(() => focusSidebarRow(threadId));
    }
  }, [actions, clearSideChatPanelTimers, focusSidebarRow, onNavigate]);

  const openSideChat = useCallback((sideChat: NativeSideChat, keepSidebarFocus = false) => {
    clearSideChatPanelTimers();
    keepSidebarFocusRef.current = keepSidebarFocus;
    setKeyboardFocusMode(keepSidebarFocus ? "sidebar" : "chat");
    setSelectedThreadId(sideChat.id);
    const sourceIsOpen = activeThreadId === sideChat.sourceThreadId;
    if (!sourceIsOpen) actions.open(sideChat.sourceThreadId);
    onNavigate();
    let attempts = 0;
    const openPanel = () => {
      const opened = navigate.openThreadPanel({
        actionId: "side-chat",
        title: sideChat.title,
        params: { childThreadId: sideChat.id },
      });
      attempts += 1;
      if (opened) {
        if (keepSidebarFocus) focusSidebarRow(sideChat.id);
        return;
      }
      if (attempts >= 10) return;
      const timer = window.setTimeout(() => {
        sideChatPanelTimersRef.current.delete(timer);
        openPanel();
      }, 80);
      sideChatPanelTimersRef.current.add(timer);
    };
    if (sourceIsOpen) openPanel();
    else {
      const timer = window.setTimeout(() => {
        sideChatPanelTimersRef.current.delete(timer);
        openPanel();
      }, 0);
      sideChatPanelTimersRef.current.add(timer);
    }
  }, [actions, activeThreadId, clearSideChatPanelTimers, focusSidebarRow, navigate, onNavigate]);

  const openSidebarTarget = useCallback((threadId: string, keepSidebarFocus = false) => {
    const sideChat = threads.flatMap((thread) => thread.sideChats).find((candidate) => candidate.id === threadId);
    if (sideChat !== undefined) openSideChat(sideChat, keepSidebarFocus);
    else openThread(threadId, keepSidebarFocus);
  }, [openSideChat, openThread, threads]);

  const renameThread = useCallback(async (thread: NativeThread, title: string) => {
    try {
      await actions.rename(thread.id, title);
      setThreads((current) => current.map((candidate) => candidate.id === thread.id ? { ...candidate, title } : candidate));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }, [actions]);

  const closeSideChat = useCallback(async (sideChat: NativeSideChat) => {
    try {
      await rpc.call("close_side_chat", { threadId: sideChat.id });
      setSelectedThreadId(sideChat.sourceThreadId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [refresh, rpc]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      const inSidebar = target !== null && listRef.current?.contains(target) === true;
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
      keepSidebarFocusRef.current = true;
      setSelectedThreadId(threadId);
      window.requestAnimationFrame(() => focusSidebarRow(threadId));
    };
    const navigateSidebar = (direction: -1 | 1) => {
      const list = listRef.current;
      if (list === null) return false;
      const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-threadflow-row]"));
      if (rows.length === 0) return false;
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const current = activeElement?.closest<HTMLElement>("[data-threadflow-row]")
        ?? rows.find((row) => row.dataset.threadId === selectedThreadId)
        ?? rows[0];
      const index = Math.max(0, rows.indexOf(current));
      const next = rows[(index + direction + rows.length) % rows.length];
      const threadId = next?.dataset.threadId;
      if (threadId === undefined) return false;
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest" });
      openSidebarTarget(threadId, true);
      return true;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const commandKey = event.key.toLocaleLowerCase();
      if (
        event.metaKey
        && !event.ctrlKey
        && !event.altKey
        && event.shiftKey
        && commandKey === "t"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) {
          void runThreadCommand(commandKey, true)
            .catch((cause) => toast.error(cause instanceof Error ? cause.message : String(cause)));
        }
        return;
      }
      if (
        event.metaKey
        && !event.ctrlKey
        && !event.altKey
        && !event.shiftKey
        && (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        navigateSidebar(event.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (
        event.metaKey
        && !event.ctrlKey
        && !event.altKey
        && event.shiftKey
        && ["e", "l", "a"].includes(commandKey)
        && listRef.current?.contains(document.activeElement)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void runThreadCommand(commandKey, event.shiftKey)
          .catch((cause) => toast.error(cause instanceof Error ? cause.message : String(cause)));
        return;
      }
      if (
        event.metaKey
        && !event.ctrlKey
        && !event.altKey
        && !event.shiftKey
        && /^[1-9]$/.test(event.key)
      ) {
        const numberedRows = Array.from(
          listRef.current?.querySelectorAll<HTMLElement>("[data-sidebar-thread-shortcut-target][data-sidebar-thread-id]") ?? [],
        );
        const row = numberedRows[Number(event.key) - 1];
        const threadId = row?.dataset.sidebarThreadId;
        if (threadId !== undefined) {
          event.preventDefault();
          event.stopImmediatePropagation();
          openSidebarTarget(threadId, true);
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const list = listRef.current;
      if (list === null) return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const focusInside = activeElement !== null && list.contains(activeElement);
      const isTyping = target?.matches("input, textarea, select, [contenteditable='true']") ?? false;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const activeSummary = activeElement?.closest<HTMLElement>('[data-threadflow-summary-open="true"]') ?? null;
        const openSummary = activeSummary ?? document.querySelector<HTMLElement>('[data-threadflow-summary-open="true"]');
        const summaryThreadId = openSummary?.dataset.threadflowSummaryThreadId;
        if (summaryThreadId !== undefined) {
          window.dispatchEvent(new CustomEvent<string>(DISMISS_CHAT_SUMMARY_EVENT, { detail: summaryThreadId }));
          return;
        }
        const mode = getKeyboardFocusMode();
        if (mode === "sidebar") {
          keepSidebarFocusRef.current = false;
          setKeyboardFocusMode("chat");
          if (activeElement !== null && list.contains(activeElement)) activeElement.blur();
        } else {
          keepSidebarFocusRef.current = true;
          focusSidebarRow(selectedThreadId);
        }
        return;
      }

      if (event.key === "/" && (focusInside || keepSidebarFocusRef.current)) return;

      if ((isTyping && !keepSidebarFocusRef.current) || (!focusInside && !keepSidebarFocusRef.current)) {
        if (
          !isTyping
          && event.key.length === 1
          && selectedThreadId !== null
          && document.documentElement.dataset.threadflowComposerScope !== "new-thread"
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          window.dispatchEvent(new CustomEvent<TypeInChatDetail>(TYPE_IN_CHAT_EVENT, {
            detail: { threadId: selectedThreadId, text: event.key },
          }));
        }
        return;
      }

      const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-threadflow-row]"));
      if (rows.length === 0) return;
      const current = target?.closest<HTMLElement>("[data-threadflow-row]")
        ?? rows.find((row) => row.dataset.threadId === selectedThreadId)
        ?? rows[0];

      if (["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const direction = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
        navigateSidebar(direction);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const threadId = current.dataset.threadId;
        if (threadId !== undefined) openSidebarTarget(threadId, true);
        return;
      }

      if (event.key.length === 1 && selectedThreadId !== null) {
        keepSidebarFocusRef.current = false;
        setKeyboardFocusMode("chat");
        event.preventDefault();
        event.stopImmediatePropagation();
        window.dispatchEvent(new CustomEvent<TypeInChatDetail>(TYPE_IN_CHAT_EVENT, {
          detail: { threadId: selectedThreadId, text: event.key },
        }));
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener(RETURN_TO_SIDEBAR_EVENT, onReturnToSidebar);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener(RETURN_TO_SIDEBAR_EVENT, onReturnToSidebar);
    };
  }, [focusSidebarRow, openSidebarTarget, runThreadCommand, selectedThreadId]);

  return (
    <div
      ref={listRef}
      className="flex h-full min-h-0 flex-col"
    >
      <ContextSwitchGuard activeThreadId={selectedThreadId} />
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {threads.map((thread) => <PullRequestProbe key={thread.id} threadId={thread.id} onChange={recordPullRequest} />)}
        {error === null ? null : <p className="px-2 py-1 text-[10px] text-destructive">{error}</p>}
        <div className="space-y-3">
          {groups.map(([title, groupThreads]) => groupThreads.length === 0 ? null : (
            <section key={title} className={title === "Working" || title === "Waiting" ? "opacity-50" : undefined}>
              <div className="flex items-center justify-between px-2 pb-1 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                <span>{title}</span>
                <span>{groupThreads.length}</span>
              </div>
              <div className="space-y-0.5">
                {groupThreads.map((thread) => (
                  <SidebarThreadRow
                    key={thread.id}
                    thread={thread}
                    backgroundCommands={nativeThreadById.get(thread.id)?.activity.backgroundCommands ?? 0}
                    pullRequest={pullRequests[thread.id] ?? null}
                    shortcutNumber={flatThreads.indexOf(thread) + 1}
                    selectedThreadId={selectedThreadId}
                    onOpen={(candidate) => openThread(candidate.id)}
                    onOpenSideChat={(sideChat) => openSideChat(sideChat)}
                    onCloseSideChat={closeSideChat}
                    onRename={renameThread}
                    showWorkingDuration={title === "Working"}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <SidebarFooter />
    </div>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "hide-host-chrome",
    mount({ signal }) {
      const style = document.createElement("style");
      style.textContent = `
        :is(button, [role="button"]):is(
          [aria-label^="open workspace in " i],
          [aria-label="choose another app to open workspace" i]
        ) { display: none !important; }

        [data-sidebar="footer"] :is(
          [aria-label="settings" i],
          [aria-label^="settings (" i],
          [data-testid="plugin-sidebar-footer-item-connect-remote"],
          [data-testid="plugin-sidebar-footer-action-connect-remote-access"],
          [aria-label="remote access" i],
          [aria-label="report a bug" i]
        ) { display: none !important; }

        [data-testid="app-desktop-sidebar-trigger"],
        [data-testid="app-sidebar-trigger-overlay"],
        [data-sidebar="sidebar"] :is(button, [role="button"]):is(
          [aria-label="go back" i],
          [aria-label="go forward" i]
        ) { display: none !important; }

        [data-testid="app-sidebar-navigation-divider"] {
          display: none !important;
        }

        [data-testid="app-page-header-content-row"]:has([data-threadflow-journal-header])
          > :first-child {
          display: none !important;
        }

        [data-testid="app-page-header-content-row"]:has([data-threadflow-journal-header])
          > [data-app-page-header-actions],
        [data-testid="app-page-header-content-row"]:has([data-threadflow-journal-header])
          > [data-app-page-header-actions] > div,
        [data-testid="app-page-header-content-row"]:has([data-threadflow-journal-header])
          [data-bb-plugin-root] {
          flex: 1 1 auto !important;
          min-width: 0 !important;
        }

        [data-message-column]
          > [class~="group/message"][class~="ml-auto"]
          > [class~="mb-1"][class~="justify-end"]:has(> span[class~="whitespace-nowrap"]),
        [data-message-column]
          > [class~="group/message"][class~="ml-auto"]
          > [class~="w-fit"][class~="flex-col"]
          > :is([class~="h-5"], [class~="h-7"]):has(button[aria-label]) {
          display: none !important;
        }

        ${NATIVE_CHAT_CSS}
        ${JOURNAL_EDITOR_CSS}
      `;
      document.head.append(style);

      let frame: number | null = null;
      let disposed = false;
      const scheduleTailSync = () => {
        if (disposed || frame !== null) return;
        frame = window.requestAnimationFrame(() => {
          frame = null;
          syncNativeUserMessages();
        });
      };
      const observer = new MutationObserver(() => scheduleTailSync());
      observer.observe(document.documentElement, { childList: true, subtree: true });
      scheduleTailSync();

      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        observer.disconnect();
        if (frame !== null) window.cancelAnimationFrame(frame);
        document.querySelectorAll(`[${MESSAGE_BUBBLE_TAIL_ATTRIBUTE}]`).forEach((tail) => tail.remove());
        document.querySelectorAll(`[${MESSAGE_BUBBLE_TAIL_SPACER_ATTRIBUTE}]`).forEach((bubble) => {
          bubble.removeAttribute(MESSAGE_BUBBLE_TAIL_SPACER_ATTRIBUTE);
        });
        document.querySelectorAll(`[${MESSAGE_TIMESTAMP_ATTRIBUTE}]`).forEach((timestamp) => timestamp.remove());
        document.querySelectorAll(`[${MESSAGE_TIMESTAMP_HOST_ATTRIBUTE}]`).forEach((host) => {
          host.removeAttribute(MESSAGE_TIMESTAMP_HOST_ATTRIBUTE);
        });
        document.querySelectorAll(`[${NUDGER_MESSAGE_ATTRIBUTE}]`).forEach((message) => {
          message.removeAttribute(NUDGER_MESSAGE_ATTRIBUTE);
        });
        style.remove();
      };
      signal.addEventListener("abort", cleanup, { once: true });
      return cleanup;
    },
  });
  app.contentScripts.register({
    id: "thread-history-shortcuts",
    mount({ signal }) {
      const onKeyDown = (event: KeyboardEvent) => {
        if (
          !event.metaKey
          || event.ctrlKey
          || event.altKey
          || event.repeat
          || event.code !== "BracketLeft" && event.code !== "BracketRight"
        ) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        window.history.go(event.code === "BracketLeft" ? -1 : 1);
      };
      window.addEventListener("keydown", onKeyDown, { capture: true, signal });
    },
  });
  app.contentScripts.register({
    id: "native-composer-chrome",
    mount({ signal }) {
      const style = document.createElement("style");
      style.textContent = NATIVE_COMPOSER_CSS;
      document.head.append(style);
      signal.addEventListener("abort", () => style.remove(), { once: true });
      return () => style.remove();
    },
  });
  app.contentScripts.register({
    id: "instant-sidebar-motion",
    mount({ signal }) {
      const style = document.createElement("style");
      style.textContent = INSTANT_SIDEBAR_CSS;
      document.head.append(style);
      signal.addEventListener("abort", () => style.remove(), { once: true });
      return () => style.remove();
    },
  });
  app.composer.customize({
    id: "native-chat-controls",
    scopes: ["thread", "side-chat", "new-thread"],
    banners: [{ id: "bridge", chrome: "bare", component: ComposerBridge }],
  });
  app.slots.experimental_threadHeaderAction({
    id: "thread-status",
    title: "Thread status",
    component: NativeThreadHeader,
  });
  app.slots.navPanel({
    id: "journal",
    title: "Journal",
    icon: "FileText",
    path: "journal",
    component: JournalPage,
    headerContent: JournalHeader,
  });
  app.slots.threadPanelAction({
    id: "side-chat",
    title: "Side chat",
    icon: "MessageQuestion",
    component: NativeSideChatPanel,
    layout: "flush",
  });
  app.slots.experimental_threadList({
    id: "compact-thread-list",
    title: "Compact thread list",
    description: "Needs you, In review, and Working with nested side chats.",
    component: CompactThreadList,
  });
  app.slots.experimental_sidebarNavigation({
    id: "keyboard-only-navigation",
    title: "Threadflow navigation",
    description: "A compact Journal button while preserving BB shortcuts.",
    component: JournalSidebarNavigation,
  });
});
