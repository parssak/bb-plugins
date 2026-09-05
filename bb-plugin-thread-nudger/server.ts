import type { BbPluginApi } from "@get-bb/plugin-sdk";

const POLL_INTERVAL_MS = 30_000;
const NUDGE_MILESTONES = [
  { afterMs: 7 * 60_000, message: "how's it going" },
  { afterMs: 22 * 60_000, message: "status update? don't stop if you're not done" },
  { afterMs: 52 * 60_000, message: "you've been going for a while, everything ok?" },
] as const;
const STATE_KEY = "nudge-milestones-v1";

type ThreadNudgeState = {
  activeSince: number;
  nextMilestoneIndex: number;
};

type NudgerState = Record<string, ThreadNudgeState>;

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

export default function plugin(bb: BbPluginApi) {
  bb.background.service("watch-active-threads", {
    async start(signal) {
      let state = parseState(await bb.storage.kv.get<unknown>(STATE_KEY));

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

          for (const threadId of Object.keys(state)) {
            if (activeIds.has(threadId)) continue;
            delete state[threadId];
            changed = true;
          }

          for (const thread of activeThreads) {
            const threadState = state[thread.id] ?? {
              activeSince: Math.min(now, thread.updatedAt),
              nextMilestoneIndex: 0,
            };
            if (state[thread.id] === undefined) {
              state[thread.id] = threadState;
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

          if (changed) await bb.storage.kv.set(STATE_KEY, state);
        } catch (cause) {
          bb.log.warn(`Thread sweep failed: ${cause instanceof Error ? cause.message : String(cause)}`);
        }

        await wait(POLL_INTERVAL_MS, signal);
      }
    },
  });
}
