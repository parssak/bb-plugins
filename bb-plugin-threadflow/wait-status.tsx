import { useCallback, useEffect, useRef, useState } from "react";
import {
  Markdown,
  UrlLink,
  useBbNavigate,
  useComposer,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { QueuedThreadWait, rpcContract } from "./contract";
import type { ActiveThreadflowWait } from "./wait-service";

type TypeInChatDetail = {
  threadId: string;
  text: string;
  /** Set by the composer that accepted the keystroke. */
  handled?: boolean;
};

const TYPE_IN_CHAT_EVENT = "threadflow:type-in-chat";

const THREADS_CHANGED_CHANNEL = "threads-changed";

const RETURN_TO_SIDEBAR_EVENT = "threadflow:return-to-sidebar";

function formatWaitTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function WaitConditionDetails({ wait }: { wait: ActiveThreadflowWait }) {
  const navigate = useBbNavigate();
  if (wait.condition.kind === "instruction") {
    return (
      <p className="text-sm leading-relaxed text-foreground">
        {wait.condition.instruction}
      </p>
    );
  }
  if (wait.condition.kind === "threads_idle") {
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {wait.condition.targets.map((target) => (
          <button
            key={target.threadId}
            type="button"
            onClick={() => navigate.toThread(target.threadId)}
            className="text-sm font-medium text-warning underline decoration-warning/40 underline-offset-4 hover:decoration-warning"
          >
            {target.title}
          </button>
        ))}
      </div>
    );
  }
  if (wait.condition.kind === "thread_archived") {
    const { targetThreadId } = wait.condition;
    return (
      <button
        type="button"
        onClick={() => navigate.toThread(targetThreadId)}
        className="text-sm font-medium text-warning underline decoration-warning/40 underline-offset-4 hover:decoration-warning"
      >
        Open {wait.condition.targetTitle}
      </button>
    );
  }
  if (wait.condition.kind === "pull_request_merged") {
    return (
      <p className="text-sm text-muted-foreground">
        <UrlLink
          href={wait.condition.pullRequestUrl}
          className="font-medium text-warning underline decoration-warning/40 underline-offset-4 hover:decoration-warning"
        >
          PR #{wait.condition.pullRequestNumber}
        </UrlLink>
        {` for ${wait.condition.targetTitle}`}
      </p>
    );
  }
  return (
    <div className="grid gap-1.5">
      {wait.condition.runs.map((run) => (
        <UrlLink
          key={run.runUrl}
          href={run.runUrl}
          className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-warning/20 bg-background/40 px-2.5 py-1.5 text-sm text-foreground hover:border-warning/40 hover:bg-warning/10"
        >
          <span className="truncate">{run.workflowName}</span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {run.headSha.slice(0, 7)}
          </span>
        </UrlLink>
      ))}
    </div>
  );
}

function queuedWaitTitle(wait: QueuedThreadWait): string {
  if (wait.waitingKind === "time" && wait.sendAt !== null) {
    return `Scheduled for ${formatWaitTimestamp(wait.sendAt)}`;
  }
  switch (wait.waitingKind) {
    case "thread-busy":
      return "Waiting for the current turn";
    case "turn-starting":
      return "Waiting for the turn to start";
    case "stopping":
      return "Waiting for the current turn to stop";
    case "provisioning":
      return "Waiting for the workspace";
    case "interaction":
      return "Waiting for your response";
    case "host-offline":
    case "plugin":
      return wait.reason;
    case "time":
    case "queued":
      return "Waiting in the queue";
  }
}

function ThreadWaitStatusCard({
  status,
}: {
  status:
    | { kind: "queued"; wait: QueuedThreadWait }
    | { kind: "threadflow"; wait: ActiveThreadflowWait };
}) {
  const title =
    status.kind === "queued" ? queuedWaitTitle(status.wait) : status.wait.label;
  const resuming =
    status.kind === "threadflow" &&
    (status.wait.state === "releasing" || status.wait.state === "ready");
  return (
    <div
      data-bb-plugin="threadflow"
      data-threadflow-wait-panel
      className="relative z-30 px-4 py-1.5"
    >
      <section
        aria-label="Thread wait status"
        className={
          resuming
            ? "rounded-lg bg-success/10 px-3 py-2.5"
            : "rounded-lg bg-warning/10 px-3 py-2.5"
        }
      >
        <h2 className="text-base font-semibold leading-snug text-foreground">
          {title}
        </h2>
        {status.kind === "queued" ? (
          status.wait.message === "" ? null : (
            <div className="mt-2 rounded-md bg-background/40 px-2.5 py-2">
              <Markdown
                content={status.wait.message}
                className="max-h-[20vh] overflow-y-auto text-sm leading-relaxed text-foreground"
              />
            </div>
          )
        ) : (
          <>
            <div className="mt-2">
              <WaitConditionDetails wait={status.wait} />
            </div>
            {!resuming && (
              <p className="mt-2 text-xs text-muted-foreground">
                {status.wait.nextCheckAt === null
                  ? "Checking condition…"
                  : `Next check: ${formatWaitTimestamp(status.wait.nextCheckAt)}`}
              </p>
            )}
            {status.wait.lastEvidence === null ? null : (
              <p className="mt-2 rounded-md bg-background/40 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                Last check: {status.wait.lastEvidence}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function NativeWaitStatus({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [wait, setWait] = useState<ActiveThreadflowWait | null>(null);
  const [queuedWait, setQueuedWait] = useState<QueuedThreadWait | null>(null);
  const loadSequenceRef = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    try {
      const result = await rpc.call("active_threadflow_wait", { threadId });
      if (loadSequenceRef.current === sequence) {
        setWait(result.wait);
        setQueuedWait(result.queuedWait);
      }
    } catch {
      // Keep the last known wait through transient plugin reloads.
    }
  }, [rpc, threadId]);

  useEffect(() => {
    setWait(null);
    setQueuedWait(null);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      loadSequenceRef.current += 1;
      window.clearInterval(timer);
    };
  }, [refresh]);
  useRealtime(THREADS_CHANGED_CHANNEL, () => void refresh());

  if (wait !== null)
    return <ThreadWaitStatusCard status={{ kind: "threadflow", wait }} />;
  return queuedWait === null ? null : (
    <ThreadWaitStatusCard status={{ kind: "queued", wait: queuedWait }} />
  );
}

export function WaitComposerBridge() {
  const composer = useComposer();
  const threadId =
    composer.scope.kind === "thread" ? composer.scope.threadId : null;
  // Only a draft started by typing on a sidebar row hands focus back to the
  // sidebar on send; drafts started in the composer keep focus in the chat.
  const startedFromSidebar = useRef(false);
  useEffect(() => {
    startedFromSidebar.current = false;
  }, [threadId]);
  useEffect(() => {
    if (!threadId) return;
    return composer.onSubmitted(() => {
      if (!startedFromSidebar.current) return;
      startedFromSidebar.current = false;
      window.dispatchEvent(
        new CustomEvent(RETURN_TO_SIDEBAR_EVENT, { detail: threadId }),
      );
    });
  }, [composer, threadId]);
  useEffect(() => {
    const type = (event: Event) => {
      const detail = (event as CustomEvent<TypeInChatDetail>).detail;
      if (
        !threadId ||
        detail?.threadId !== threadId ||
        detail.text?.length !== 1
      )
        return;
      detail.handled = true;
      startedFromSidebar.current = true;
      composer.insert(detail.text, { at: "end" });
      composer.focus();
    };
    window.addEventListener(TYPE_IN_CHAT_EVENT, type);
    return () => window.removeEventListener(TYPE_IN_CHAT_EVENT, type);
  }, [composer, threadId]);
  return threadId ? <NativeWaitStatus threadId={threadId} /> : null;
}
