import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const POLL_INTERVAL_MS = 30_000;
const NUDGE_MILESTONES = [
  { afterMs: 7 * 60_000, message: "how's it going" },
  { afterMs: 22 * 60_000, message: "status update? don't stop if you're not done" },
  { afterMs: 52 * 60_000, message: "you've been going for a while, everything ok?" },
] as const;
const LEGACY_STATE_KEY = "nudge-milestones-v1";
const STATE_KEY = "thread-nudger-state-v2";
const NUDGING_CHANGED_CHANNEL = "nudging-changed";

type ThreadNudgeState = {
  activeSince: number;
  nextMilestoneIndex: number;
};

type NudgerState = Record<string, ThreadNudgeState>;

type PersistedState = {
  threads: NudgerState;
  disabledThreads: Record<string, true>;
};

const threadIdSchema = z.string().min(1).max(128);

export const rpcContract = defineRpcContract({
  getThreadNudging: {
    input: z.object({ threadId: threadIdSchema }).strict(),
    output: z.object({ enabled: z.boolean() }).strict(),
  },
  setThreadNudging: {
    input: z.object({ threadId: threadIdSchema, enabled: z.boolean() }).strict(),
    output: z.object({ enabled: z.boolean() }).strict(),
  },
});

export function createThreadNudgeInput(message: string) {
  return {
    type: "text" as const,
    text: message,
    mentions: [],
    visibility: "agent-only" as const,
  };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function isThreadNudgeState(value: unknown): value is ThreadNudgeState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return typeof state.activeSince === "number"
    && typeof state.nextMilestoneIndex === "number";
}

function parseState(value: unknown): NudgerState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, ThreadNudgeState] => isThreadNudgeState(entry[1])),
  );
}

function parseDisabledThreads(value: unknown): Record<string, true> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, true] => entry[1] === true),
  );
}

function parsePersistedState(value: unknown): PersistedState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  return {
    threads: parseState(state.threads),
    disabledThreads: parseDisabledThreads(state.disabledThreads),
  };
}

export default async function plugin(bb: BbPluginApi) {
  const storedState = parsePersistedState(await bb.storage.kv.get<unknown>(STATE_KEY));
  const state: PersistedState = storedState ?? {
    threads: parseState(await bb.storage.kv.get<unknown>(LEGACY_STATE_KEY)),
    disabledThreads: {},
  };

  const persistState = () => bb.storage.kv.set(STATE_KEY, state);

  bb.rpc.register(rpcContract, {
    getThreadNudging({ threadId }) {
      return { enabled: state.disabledThreads[threadId] !== true };
    },
    async setThreadNudging({ threadId, enabled }) {
      const wasEnabled = state.disabledThreads[threadId] !== true;
      if (enabled === wasEnabled) return { enabled };

      if (enabled) {
        delete state.disabledThreads[threadId];
        state.threads[threadId] = {
          activeSince: Date.now(),
          nextMilestoneIndex: 0,
        };
      } else {
        state.disabledThreads[threadId] = true;
        delete state.threads[threadId];
      }
      await persistState();
      bb.realtime.publish(NUDGING_CHANGED_CHANNEL, { threadId, enabled });
      return { enabled };
    },
  });

  bb.events.on("thread.deleted", async ({ thread }) => {
    const hadState = state.threads[thread.id] !== undefined
      || state.disabledThreads[thread.id] !== undefined;
    if (!hadState) return;
    delete state.threads[thread.id];
    delete state.disabledThreads[thread.id];
    await persistState();
  });

  bb.background.service("watch-active-threads", {
    async start(signal) {
      while (!signal.aborted) {
        try {
          const now = Date.now();
          const threads = await bb.sdk.threads.list({
            archived: false,
            includeHidden: false,
            limit: 200,
          });
          const activeThreads = threads.filter((thread) => thread.status === "active");
          const activeIds = new Set(activeThreads.map((thread) => thread.id));
          let changed = false;

          for (const threadId of Object.keys(state.threads)) {
            if (activeIds.has(threadId) && state.disabledThreads[threadId] !== true) continue;
            delete state.threads[threadId];
            changed = true;
          }

          for (const thread of activeThreads) {
            if (state.disabledThreads[thread.id] === true) continue;
            const threadState = state.threads[thread.id] ?? {
              activeSince: Math.min(now, thread.updatedAt),
              nextMilestoneIndex: 0,
            };
            if (state.threads[thread.id] === undefined) {
              state.threads[thread.id] = threadState;
              changed = true;
            }
            const elapsedMs = now - threadState.activeSince;
            let dueMilestoneIndex = -1;
            for (let index = threadState.nextMilestoneIndex; index < NUDGE_MILESTONES.length; index += 1) {
              if (elapsedMs < NUDGE_MILESTONES[index].afterMs) break;
              dueMilestoneIndex = index;
            }
            if (dueMilestoneIndex === -1) continue;

            const milestone = NUDGE_MILESTONES[dueMilestoneIndex];

            // Advance before sending so reloads, compaction, or transient failures cannot create catch-up bursts.
            threadState.nextMilestoneIndex = dueMilestoneIndex + 1;
            changed = true;
            try {
              await bb.sdk.threads.send({
                threadId: thread.id,
                mode: "steer",
                input: [createThreadNudgeInput(milestone.message)],
              });
              bb.log.info(`Nudged ${thread.id}: ${milestone.message}`);
            } catch (cause) {
              bb.log.debug(`Could not nudge ${thread.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
            }
          }

          if (changed) await persistState();
        } catch (cause) {
          bb.log.warn(`Thread sweep failed: ${cause instanceof Error ? cause.message : String(cause)}`);
        }

        await wait(POLL_INTERVAL_MS, signal);
      }
    },
  });
}
