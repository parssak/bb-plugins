import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { isThreadNudgerMessageText } from "./thread-nudger-message";
import {
  formatUserMessageTimestamp,
  type UserMessageTimestamp,
} from "./user-message-timestamp";

const MESSAGE_BUBBLE_TAIL_PATH =
  "M8.33594 0.5C8.7668 0.821894 9.07248 1.04615 9.30176 1.21094C9.55938 1.3961 9.70552 1.49813 9.8252 1.58789C9.97196 1.69798 10.063 1.78007 10.2666 1.97949C9.91758 2.45087 9.86145 3.11747 9.9082 3.72559C9.97604 4.60748 10.2761 5.65946 10.6572 6.67578C11.041 7.69919 11.519 8.71995 11.9658 9.5498C12.3707 10.3016 12.7783 10.9463 13.0811 11.2812C13.1997 11.5187 13.2999 11.7209 13.3594 11.9004C13.3992 12.0208 13.4042 12.0854 13.4043 12.1133C13.3726 12.1293 13.2986 12.1562 13.1455 12.1699C12.8453 12.1969 12.3568 12.1616 11.5977 12.0098C9.22996 11.5361 7.06273 9.98557 5.25586 8.49023C4.3835 7.76828 3.54044 7.01048 2.88281 6.48438C2.54469 6.21388 2.22287 5.97683 1.92773 5.80566C1.64508 5.64174 1.32344 5.5 1 5.5H0.5V0.5H8.33594Z";

const MESSAGE_BUBBLE_TAIL_ATTRIBUTE = "data-threadflow-user-bubble-tail";

const MESSAGE_BUBBLE_TAIL_SPACER_ATTRIBUTE =
  "data-threadflow-user-bubble-tail-spacer";

const MESSAGE_TIMESTAMP_ATTRIBUTE = "data-threadflow-user-message-timestamp";

const MESSAGE_TIMESTAMP_HOST_ATTRIBUTE =
  "data-threadflow-user-message-timestamp-host";

const NUDGER_MESSAGE_ATTRIBUTE = "data-threadflow-nudger-message";

const THREAD_HEADER_TITLE_HOST_ATTRIBUTE = "data-threadflow-header-title-host";

const THREAD_HEADER_TITLE_CONTENT_ATTRIBUTE =
  "data-threadflow-header-title-content";

export const NATIVE_USER_MESSAGE_SELECTOR = `[data-message-column] > [class~="group/message"][class~="ml-auto"]`;

const NATIVE_USER_BUBBLE_RELATIVE_SELECTOR = `:scope > [class~="w-fit"][class~="flex-col"] > [class~="bg-surface-recessed"]`;

const NATIVE_USER_BUBBLE_SELECTOR = `${NATIVE_USER_MESSAGE_SELECTOR} > [class~="w-fit"][class~="flex-col"] > [class~="bg-surface-recessed"]`;

const NATIVE_STEER_HEADER_SELECTOR = `:scope > [class~="mb-1"][class~="justify-end"]:has(> span[class~="whitespace-nowrap"])`;

const nativeUserMessageTimestamps = new Map<
  string,
  { threadId: string; createdAt: number }
>();

const nativeUserMessageTimestampRowsByThread = new Map<string, Set<string>>();

export function replaceNativeUserMessageTimestamps(
  threadId: string,
  messages: readonly UserMessageTimestamp[],
): void {
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
      if (
        existing === undefined ||
        existing.threadId !== threadId ||
        existing.createdAt <= message.createdAt
      ) {
        nativeUserMessageTimestamps.set(rowId, {
          threadId,
          createdAt: message.createdAt,
        });
      }
      nextRowIds.add(rowId);
    }
  }
  nativeUserMessageTimestampRowsByThread.set(threadId, nextRowIds);
  syncNativeUserMessages();
}

export function clearNativeUserMessageTimestamps(threadId: string): void {
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
  const userMessages = Array.from(
    document.querySelectorAll<HTMLElement>(NATIVE_USER_MESSAGE_SELECTOR),
  );
  for (const message of userMessages) {
    const bubble = message.querySelector<HTMLElement>(
      NATIVE_USER_BUBBLE_RELATIVE_SELECTOR,
    );
    const isNudgerMessage =
      message.querySelector(NATIVE_STEER_HEADER_SELECTOR) !== null &&
      bubble !== null &&
      isThreadNudgerMessageText(bubble.textContent ?? "");
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

  const timelineLists = Array.from(
    document.querySelectorAll<HTMLElement>("[data-timeline-row-list]"),
  );
  for (const list of timelineLists) {
    const rows = Array.from(list.querySelectorAll<HTMLElement>(rowSelector));
    for (const [index, row] of rows.entries()) {
      const userMessage = row.querySelector<HTMLElement>(
        NATIVE_USER_MESSAGE_SELECTOR,
      );
      if (
        userMessage === null ||
        userMessage.hasAttribute(NUDGER_MESSAGE_ATTRIBUTE)
      )
        continue;
      const nextRow = rows[index + 1];
      const nextUserMessage = nextRow?.querySelector<HTMLElement>(
        NATIVE_USER_MESSAGE_SELECTOR,
      );
      if (
        nextUserMessage != null &&
        !nextUserMessage.hasAttribute(NUDGER_MESSAGE_ATTRIBUTE)
      )
        continue;

      const bubble = row.querySelector<HTMLElement>(
        NATIVE_USER_BUBBLE_SELECTOR,
      );
      if (bubble !== null) {
        desiredBubbles.add(bubble);
        if (index === rows.length - 1) bottomBubbles.add(bubble);
      }

      const timestampRow = userMessage.closest<HTMLElement>(
        "[data-timeline-row-id]",
      );
      const timestampRowId = timestampRow?.dataset.timelineRowId;
      const timestamp =
        timestampRowId === undefined
          ? undefined
          : nativeUserMessageTimestamps.get(timestampRowId);
      if (timestamp !== undefined)
        desiredTimestampHosts.set(userMessage, timestamp.createdAt);
    }
  }

  const existingTails = Array.from(
    document.querySelectorAll<SVGSVGElement>(
      `[${MESSAGE_BUBBLE_TAIL_ATTRIBUTE}]`,
    ),
  );
  for (const tail of existingTails) {
    const bubble = tail.parentElement;
    if (bubble === null || !desiredBubbles.has(bubble)) tail.remove();
  }

  for (const bubble of desiredBubbles) {
    if (
      bubble.querySelector(`:scope > [${MESSAGE_BUBBLE_TAIL_ATTRIBUTE}]`) ===
      null
    ) {
      bubble.append(createNativeUserBubbleTail());
    }
  }

  const existingSpacers = Array.from(
    document.querySelectorAll<HTMLElement>(
      `[${MESSAGE_BUBBLE_TAIL_SPACER_ATTRIBUTE}]`,
    ),
  );
  for (const bubble of existingSpacers) {
    if (!bottomBubbles.has(bubble))
      bubble.removeAttribute(MESSAGE_BUBBLE_TAIL_SPACER_ATTRIBUTE);
  }
  for (const bubble of bottomBubbles)
    bubble.setAttribute(MESSAGE_BUBBLE_TAIL_SPACER_ATTRIBUTE, "");

  const existingTimestampHosts = Array.from(
    document.querySelectorAll<HTMLElement>(
      `[${MESSAGE_TIMESTAMP_HOST_ATTRIBUTE}]`,
    ),
  );
  for (const host of existingTimestampHosts) {
    if (desiredTimestampHosts.has(host)) continue;
    host.removeAttribute(MESSAGE_TIMESTAMP_HOST_ATTRIBUTE);
    host.querySelector(`:scope > [${MESSAGE_TIMESTAMP_ATTRIBUTE}]`)?.remove();
  }
  for (const [host, createdAt] of desiredTimestampHosts) {
    host.setAttribute(MESSAGE_TIMESTAMP_HOST_ATTRIBUTE, "");
    let timestamp = host.querySelector<HTMLTimeElement>(
      `:scope > [${MESSAGE_TIMESTAMP_ATTRIBUTE}]`,
    );
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

const NATIVE_CHAT_CSS = `
  [${THREAD_HEADER_TITLE_HOST_ATTRIBUTE}] {
    position: relative !important;
    color: transparent !important;
  }

  [${THREAD_HEADER_TITLE_HOST_ATTRIBUTE}] > :not([${THREAD_HEADER_TITLE_CONTENT_ATTRIBUTE}]) {
    visibility: hidden !important;
  }

  [${THREAD_HEADER_TITLE_CONTENT_ATTRIBUTE}] {
    position: absolute;
    inset: 0;
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.35em;
    color: var(--foreground) !important;
    pointer-events: none;
  }

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
    top: calc(100% + 5px);
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

  [data-promptbox-standard-actions] button[aria-label="Start voice input"] {
    display: none !important;
  }

  [data-promptbox-submit-action]:not([aria-label="Stop run"]):not([aria-label="Start voice input"]) svg * {
    stroke-width: 2.25 !important;
  }
`;
export function registerChatDecorations(
  app: Parameters<Parameters<typeof definePluginApp>[0]>[0],
) {
  app.contentScripts.register({
    id: "hide-host-chrome",
    mount({ signal }) {
      const style = document.createElement("style");
      style.textContent = `
        :is(button, [role="button"]):is(
          [aria-label^="open workspace in " i],
          [aria-label="choose another app to open workspace" i]
        ) { display: none !important; }

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
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      scheduleTailSync();

      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        observer.disconnect();
        if (frame !== null) window.cancelAnimationFrame(frame);
        document
          .querySelectorAll(`[${MESSAGE_BUBBLE_TAIL_ATTRIBUTE}]`)
          .forEach((tail) => tail.remove());
        document
          .querySelectorAll(`[${MESSAGE_BUBBLE_TAIL_SPACER_ATTRIBUTE}]`)
          .forEach((bubble) => {
            bubble.removeAttribute(MESSAGE_BUBBLE_TAIL_SPACER_ATTRIBUTE);
          });
        document
          .querySelectorAll(`[${MESSAGE_TIMESTAMP_ATTRIBUTE}]`)
          .forEach((timestamp) => timestamp.remove());
        document
          .querySelectorAll(`[${MESSAGE_TIMESTAMP_HOST_ATTRIBUTE}]`)
          .forEach((host) => {
            host.removeAttribute(MESSAGE_TIMESTAMP_HOST_ATTRIBUTE);
          });
        document
          .querySelectorAll(`[${NUDGER_MESSAGE_ATTRIBUTE}]`)
          .forEach((message) => {
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
          !event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.repeat ||
          (event.code !== "BracketLeft" && event.code !== "BracketRight")
        )
          return;
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
}
