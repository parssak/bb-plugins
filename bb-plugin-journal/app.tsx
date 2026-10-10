import "./app.css";
import {
  JournalAppearanceOverlay,
  openJournalAppearance,
} from "./journal-appearance-overlay";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Message01Icon,
} from "@hugeicons/core-free-icons";
import {
  ThreadChat,
  definePluginApp,
  experimental_useAppPanel,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contract";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { JournalMarkdownEditor } from "./journal-editor";
import {
  formatJournalDate,
  isJournalDateKey,
  localJournalDateKey,
  shiftJournalDateKey,
} from "./journal-date";
import { threadReferenceIds } from "./thread-reference";

const THREADS_CHANGED_CHANNEL = "threads-changed";

function useJournalToday(): string {
  const [today, setToday] = useState(() => localJournalDateKey());
  useEffect(() => {
    const timer = window.setInterval(
      () => setToday(localJournalDateKey()),
      30_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  return today;
}

function journalDateFromSubPath(subPath: string, today: string): string {
  return isJournalDateKey(subPath) ? subPath : today;
}

function JournalChatPanel({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const today = useJournalToday();
  const dateKey = journalDateFromSubPath(subPath, today);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadSequenceRef = useRef(0);

  const load = useCallback(async () => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    setThreadId(null);
    setError(null);
    try {
      const result = await rpc.call("journal_chat", { dateKey });
      if (loadSequenceRef.current !== sequence) return;
      setThreadId(result.threadId);
    } catch (cause) {
      if (loadSequenceRef.current !== sequence) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [dateKey, rpc]);
  useEffect(() => {
    void load();
    return () => {
      loadSequenceRef.current += 1;
    };
  }, [load]);

  if (error !== null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground">
        <p>Couldn’t open this journal chat.</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void load()}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (threadId === null) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Opening journal chat…
      </div>
    );
  }
  return (
    <ThreadChat
      threadId={threadId}
      variant="compact"
      layout="contained"
      permissionPolicy="editable"
      className="h-full min-h-0"
    />
  );
}

const JOURNAL_CHAT_TAB = {
  panelId: "journal",
  id: "chat",
  title: "Chat",
  icon: "MessageQuestion",
  component: JournalChatPanel,
  layout: "flush",
} as const;

function JournalHeader({ subPath }: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  const appPanel = experimental_useAppPanel();
  const today = useJournalToday();
  const dateKey = journalDateFromSubPath(subPath, today);
  const heading = formatJournalDate(dateKey);
  const goToDate = useCallback(
    (nextDateKey: string) => {
      navigate.toPluginPanel("journal", {
        subPath: nextDateKey === today ? "" : nextDateKey,
      });
    },
    [navigate, today],
  );

  return (
    <div
      data-threadflow-journal-header
      className="flex min-w-0 flex-1 items-center gap-1"
    >
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
          className="block truncate text-sm font-semibold uppercase tabular-nums text-foreground"
          style={{
            fontFamily:
              '"JetBrains Mono", var(--font-mono, ui-monospace, monospace)',
          }}
        >
          {heading}
        </span>
        <input
          type="date"
          value={dateKey}
          max={today}
          aria-label="Choose journal date"
          onChange={(event) => {
            if (isJournalDateKey(event.target.value))
              goToDate(event.target.value);
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
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label="Open journal chat"
        title="Open journal chat"
        className="ml-auto h-7 shrink-0 gap-1 px-2"
        onClick={() => {
          const opened = appPanel.openFixedTab({
            surface: { kind: "current" },
            tab: JOURNAL_CHAT_TAB,
          });
          if (!opened) toast.error("Journal chat isn’t available in this view");
        }}
      >
        <HugeiconsIcon icon={Message01Icon} className="size-4" aria-hidden />
        Chat
      </Button>
    </div>
  );
}

function JournalDay({ dateKey }: { dateKey: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [content, setContent] = useState("");
  const [threadStatuses, setThreadStatuses] = useState<
    Record<string, "archived" | "in-progress">
  >({});
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
  const statusSequenceRef = useRef(0);
  const referencedThreadIds = useMemo(
    () => threadReferenceIds(content).slice(0, 100),
    [content],
  );
  const referencedThreadIdsKey = referencedThreadIds.join("\n");

  const refreshThreadStatuses = useCallback(async () => {
    const sequence = statusSequenceRef.current + 1;
    statusSequenceRef.current = sequence;
    const threadIds =
      referencedThreadIdsKey === "" ? [] : referencedThreadIdsKey.split("\n");
    if (threadIds.length === 0) {
      setThreadStatuses({});
      return;
    }
    try {
      const result = await rpc.call("journal_thread_statuses", { threadIds });
      if (!mountedRef.current || statusSequenceRef.current !== sequence) return;
      setThreadStatuses(
        Object.fromEntries(
          result.statuses.map(({ threadId, status }) => [threadId, status]),
        ),
      );
    } catch {
      // Keep the last known colors through transient status lookup failures.
    }
  }, [referencedThreadIdsKey, rpc]);

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
      statusSequenceRef.current += 1;
      void flush();
    };
  }, [flush, load]);
  useEffect(() => {
    void refreshThreadStatuses();
  }, [refreshThreadStatuses]);
  useRealtime(THREADS_CHANGED_CHANNEL, () => void refreshThreadStatuses());
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
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void load()}
            >
              Try again
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <main
      className="threadflow-journal-document mx-auto flex h-full w-full flex-col px-6 pb-8 md:px-10 md:pb-10"
      style={{
        maxWidth: "var(--journal-document-width, 768px)",
        paddingTop: "var(--journal-top-padding, 12px)",
      }}
    >
      <JournalMarkdownEditor
        initialMarkdown={content}
        ariaLabel={`Journal for ${heading}`}
        onMarkdownChange={(nextContent) => {
          desiredContentRef.current = nextContent;
          setContent(nextContent);
        }}
        onBlur={() => void flush()}
        onOpenThread={(threadId) => navigate.toThread(threadId)}
        threadStatuses={threadStatuses}
      />
      {saveError ? (
        <span
          role="status"
          className="mt-2 shrink-0 text-right text-xs text-destructive"
        >
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

export default definePluginApp((app) => {
  app.slots.commandPaletteAction({
    id: "adjust-journal-ui",
    title: "Adjust journal UI",
    run: openJournalAppearance,
  });
  app.slots.experimental_appOverlay({
    id: "journal-appearance",
    component: JournalAppearanceOverlay,
  });
  app.slots.navPanel({
    id: "journal",
    title: "Journal",
    icon: "FileText",
    path: "journal",
    component: JournalPage,
    headerContent: JournalHeader,
    fixedTabs: [JOURNAL_CHAT_TAB],
  });
});
