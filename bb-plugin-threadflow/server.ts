import { legacyStorageContract, ownsLegacyKey } from "./legacy-storage.ts";
import { rpcContract } from "./contract.ts";
import { spawn } from "node:child_process";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  advanceCompletionAlertState,
  getCompletionAlertSnapshot,
  initialCompletionAlertState,
  isCompletionThreadRelevant,
  type CompletionAlertMode,
} from "./completion-alert.ts";
import { registerThreadflowWaits } from "./wait-service.ts";

const WORKOUT_SCRATCHPAD_KEY = "workout:scratchpad:v1";

const MAX_WORKOUT_SCRATCHPAD_LENGTH = 4_000;

const queuedThreadWaitSchema = z
  .object({
    id: z.string(),
    waitingKind: z.enum([
      "time",
      "thread-busy",
      "turn-starting",
      "stopping",
      "provisioning",
      "host-offline",
      "interaction",
      "plugin",
      "queued",
    ]),
    reason: z.string(),
    message: z.string(),
    sendAt: z.number().nullable(),
  })
  .strict();

export type QueuedThreadWait = z.infer<typeof queuedThreadWaitSchema>;

const MAX_THREADS_PER_STATE = 200;

const THREADS_CHANGED_CHANNEL = "threads-changed";

const SUMMARY_WORKER_TITLE_PREFIX = "TLDR worker:";

const COMPLETION_ALERT_SETTLE_MS = 2_000;

const COMPLETION_CHIME_PATH = "/System/Library/Sounds/Glass.aiff";

function playCompletionAlert(
  mode: Exclude<CompletionAlertMode, "Off">,
  bb: BbPluginApi,
): void {
  const child =
    mode === "Voice"
      ? spawn("/usr/bin/say", ["All threads are ready."], {
          detached: true,
          stdio: "ignore",
        })
      : spawn("/usr/bin/afplay", [COMPLETION_CHIME_PATH], {
          detached: true,
          stdio: "ignore",
        });
  child.once("error", (cause) => {
    bb.log.warn(`Could not play completion alert: ${cause.message}`);
  });
  child.unref();
}

function isRunningStatus(status: string): boolean {
  return status !== "idle" && status !== "error";
}

type QueuedMessage = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["queuedMessages"]["list"]>
>[number];

function queuedMessageText(entry: QueuedMessage): string {
  return entry.content
    .flatMap((part) =>
      part.type === "text" && part.visibility !== "agent-only"
        ? [part.text.trim()]
        : [],
    )
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 1_000);
}

function queuedWaitReason(entry: QueuedMessage): QueuedThreadWait["reason"] {
  if (entry.waitingOn === null)
    return "This continuation is waiting in the queue.";
  switch (entry.waitingOn.kind) {
    case "time":
      return "This continuation will be sent automatically at the scheduled time.";
    case "thread-busy":
      return "The current turn must finish before this continuation can be sent.";
    case "turn-starting":
      return "The current turn must start before this continuation can be sent.";
    case "stopping":
      return "The current turn must stop before this continuation can be sent.";
    case "provisioning":
      return "The workspace must finish provisioning before this continuation can be sent.";
    case "host-offline":
      return `Waiting for ${entry.waitingOn.hostName} to come back online.`;
    case "interaction":
      return "This thread needs your response before the continuation can be sent.";
    case "plugin":
      return entry.waitingOn.reason;
  }
}

async function queuedWaitForThread(
  bb: BbPluginApi,
  threadId: string,
): Promise<QueuedThreadWait | null> {
  const [thread, entries] = await Promise.all([
    bb.sdk.threads.get({ threadId }),
    bb.sdk.threads.queuedMessages.list({ threadId }),
  ]);
  if (thread.archivedAt !== null || thread.runtime.displayStatus !== "idle")
    return null;
  const entry =
    entries.find(
      (candidate) => candidate.waitingOn !== null || candidate.sendAt !== null,
    ) ?? entries[0];
  if (entry === undefined) return null;
  return {
    id: entry.id,
    waitingKind: entry.waitingOn?.kind ?? "queued",
    reason: queuedWaitReason(entry),
    message: queuedMessageText(entry),
    sendAt: entry.sendAt,
  };
}

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(legacyStorageContract, {
    migration_keys: async ({ domain }) => ({
      keys: (await bb.storage.kv.list()).filter((key) =>
        ownsLegacyKey(domain, key),
      ),
    }),
    migration_value: async ({ domain, key }) => {
      if (!ownsLegacyKey(domain, key)) throw new Error("Not a migratable key");
      const value = await bb.storage.kv.get(key);
      return {
        found: value !== undefined,
        value: value === undefined ? null : z.json().parse(value),
      };
    },
  });
  const settings = bb.settings.define({
    completionAlert: {
      type: "select",
      label: "All work finished alert",
      options: ["Off", "Chime", "Voice"],
      default: "Chime",
    },
    githubToken: {
      type: "string",
      label: "GitHub token",
      description:
        "Fine-grained token with Actions read access, required for waits on private repositories.",
      secret: true,
    },
  });
  const threadflowWaits = registerThreadflowWaits(bb, {
    excludedThreadTitlePrefixes: [SUMMARY_WORKER_TITLE_PREFIX],
    getGithubToken: async () => (await settings.get()).githubToken,
  });
  let completionAlertState = initialCompletionAlertState;
  const completionAlertReadyThreadIds = new Set<string>();
  let completionAlertTimer: ReturnType<typeof setTimeout> | null = null;
  let completionAlertMonitorRunning = false;
  let completionAlertChecks = Promise.resolve();
  let kvMutationTail = Promise.resolve();
  const serializeKvMutation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = kvMutationTail.then(operation, operation);
    kvMutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const publishThreadsChanged = () =>
    bb.realtime.publish(THREADS_CHANGED_CHANNEL, null);
  const checkCompletionAlert = async () => {
    try {
      const [visibleThreads, hiddenForks] = await Promise.all([
        bb.sdk.threads.list({
          archived: false,
          includeHidden: false,
          limit: MAX_THREADS_PER_STATE,
        }),
        bb.sdk.threads.list({
          archived: false,
          includeHidden: true,
          originKind: "fork",
          limit: MAX_THREADS_PER_STATE,
        }),
      ]);
      const snapshot = getCompletionAlertSnapshot(visibleThreads, hiddenForks);
      const result = advanceCompletionAlertState(completionAlertState, {
        ...snapshot,
        hasAttention:
          snapshot.hasAttention || completionAlertReadyThreadIds.size > 0,
      });
      if (!completionAlertMonitorRunning) return;
      completionAlertState = result.state;
      if (!snapshot.hasRunningWork) completionAlertReadyThreadIds.clear();
      if (!result.shouldAlert) return;

      const { completionAlert } = await settings.get();
      if (
        completionAlertMonitorRunning &&
        (completionAlert === "Chime" || completionAlert === "Voice")
      ) {
        playCompletionAlert(completionAlert, bb);
      }
    } catch (cause) {
      bb.log.warn(
        `Could not check completion alert state: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };
  const enqueueCompletionAlertCheck = () => {
    completionAlertChecks = completionAlertChecks.then(
      checkCompletionAlert,
      checkCompletionAlert,
    );
    return completionAlertChecks;
  };
  const scheduleCompletionAlertCheck = () => {
    if (!completionAlertMonitorRunning) return;
    if (completionAlertTimer !== null) clearTimeout(completionAlertTimer);
    completionAlertTimer = setTimeout(() => {
      completionAlertTimer = null;
      void enqueueCompletionAlertCheck();
    }, COMPLETION_ALERT_SETTLE_MS);
    completionAlertTimer.unref?.();
  };
  const armCompletionAlertFor = (
    thread: Parameters<typeof isCompletionThreadRelevant>[0],
  ) => {
    if (!isCompletionThreadRelevant(thread)) return;
    completionAlertState = { initialized: true, armed: true };
  };
  const markCompletionAlertReady = (
    thread: Parameters<typeof isCompletionThreadRelevant>[0] & { id: string },
  ) => {
    if (isCompletionThreadRelevant(thread))
      completionAlertReadyThreadIds.add(thread.id);
  };
  const archiveSourceThread = async (threadId: string) => {
    const thread = await bb.sdk.threads.get({ threadId });
    if (isRunningStatus(thread.status)) {
      throw new Error(
        `Cannot archive "${thread.title?.trim() || thread.titleFallback?.trim() || "Untitled"}" while it is running.`,
      );
    }

    if (thread.sourceThreadId !== null) {
      await bb.sdk.threads.archive({ threadId });
      return;
    }

    const sideChats = await bb.sdk.threads.list({
      sourceThreadId: threadId,
      archived: false,
      includeHidden: true,
      limit: MAX_THREADS_PER_STATE,
    });
    const runningSideChat = sideChats.find((sideChat) =>
      isRunningStatus(sideChat.status),
    );
    if (runningSideChat !== undefined) {
      throw new Error(
        `Cannot archive this worktree while "${runningSideChat.title?.trim() || runningSideChat.titleFallback?.trim() || "Side chat"}" is running.`,
      );
    }

    if (thread.environmentId === null) {
      await bb.sdk.threads.archive({ threadId });
      return;
    }

    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
    });
    if (environment.workspaceProvisionType !== "managed-worktree") {
      await bb.sdk.threads.archive({ threadId });
      return;
    }

    await bb.sdk.environments.archiveThreads({
      environmentId: environment.id,
    });
  };
  for (const event of [
    "thread.created",
    "thread.active",
    "thread.idle",
    "thread.failed",
    "thread.archived",
    "thread.deleted",
    "interaction.pending",
    "message.queued",
    "message.dispatched",
  ] as const)
    bb.events.on(event, publishThreadsChanged);
  bb.events.on("thread.active", ({ thread }) => {
    armCompletionAlertFor(thread);
    scheduleCompletionAlertCheck();
  });
  for (const event of [
    "thread.idle",
    "thread.failed",
    "interaction.pending",
  ] as const)
    bb.events.on(event, ({ thread }) => {
      markCompletionAlertReady(thread);
      scheduleCompletionAlertCheck();
    });
  for (const event of ["thread.archived", "thread.deleted"] as const)
    bb.events.on(event, ({ thread }) => {
      completionAlertReadyThreadIds.delete(thread.id);
      scheduleCompletionAlertCheck();
    });
  bb.background.service("completion-alert-monitor", {
    async start(signal) {
      completionAlertMonitorRunning = true;
      await enqueueCompletionAlertCheck();
      if (!signal.aborted) {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      }
      completionAlertMonitorRunning = false;
      if (completionAlertTimer !== null) clearTimeout(completionAlertTimer);
      completionAlertTimer = null;
      await completionAlertChecks;
    },
  });
  bb.rpc.register(rpcContract, {
    wait_dependencies: async () => {
      const queue = await bb.sdk.threads.queue.list();
      return {
        dependencies: threadflowWaits.getThreadDependencies(
          new Set(queue.map((entry) => entry.id)),
        ),
        scheduledSends: queue.flatMap((entry) =>
          entry.waitingOn?.kind === "time" && entry.sendAt !== null
            ? [{ threadId: entry.threadId, sendAt: entry.sendAt }]
            : [],
        ),
      };
    },

    close_side_chat: async ({ threadId }) => {
      const thread = await bb.sdk.threads.get({ threadId });
      if (
        thread.sourceThreadId === null ||
        thread.originKind !== "fork" ||
        thread.visibility !== "hidden"
      )
        throw new Error("This thread is not a side chat.");
      if (isRunningStatus(thread.status)) {
        await bb.sdk.threads.stop({ threadId });
      }
      await bb.sdk.threads.archive({ threadId });
      publishThreadsChanged();
      return { ok: true as const };
    },
    toggle_archived: async ({ id }) => {
      const thread = await bb.sdk.threads.get({ threadId: id });
      const archived = thread.archivedAt === null;
      if (archived) await archiveSourceThread(id);
      else await bb.sdk.threads.unarchive({ threadId: id });
      publishThreadsChanged();
      return { archived };
    },
    workout_scratchpad: async ({ legacyContent }) =>
      serializeKvMutation(async () => {
        const stored = await bb.storage.kv.get<unknown>(WORKOUT_SCRATCHPAD_KEY);
        if (
          typeof stored === "string" &&
          stored.length <= MAX_WORKOUT_SCRATCHPAD_LENGTH
        ) {
          return { content: stored };
        }
        const content = legacyContent ?? "";
        if (content !== "")
          await bb.storage.kv.set(WORKOUT_SCRATCHPAD_KEY, content);
        return { content };
      }),
    save_workout_scratchpad: async ({ content }) =>
      serializeKvMutation(async () => {
        if (content === "") await bb.storage.kv.delete(WORKOUT_SCRATCHPAD_KEY);
        else await bb.storage.kv.set(WORKOUT_SCRATCHPAD_KEY, content);
        return { ok: true as const };
      }),
    active_threadflow_wait: async ({ threadId }) => {
      const wait = await threadflowWaits.getActiveWait(threadId);
      return {
        wait,
        queuedWait:
          wait === null ? await queuedWaitForThread(bb, threadId) : null,
      };
    },
  });
}
