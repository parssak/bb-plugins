import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { activeThreadflowWaitSchema } from "./wait-service.ts";

const MAX_WORKOUT_SCRATCHPAD_LENGTH = 4_000;

const hiddenChildThreadSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    parentThreadId: z.string(),
    createdAt: z.number(),
    status: z.string(),
    needsAttention: z.boolean(),
    backgroundWork: z.number(),
    originKind: z.enum(["fork"]).nullable(),
    originPluginId: z.string().nullable(),
  })
  .strict();

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

export type NativeChildThread = {
  id: string;
  title: string;
  parentThreadId: string;
  createdAt: number;
  status: string;
  needsAttention: boolean;
  /** Background agents and workflows still running for this thread. */
  backgroundWork: number;
  closeable: boolean;
  navigation: "thread" | "split";
  children: NativeChildThread[];
};

export type NativeThread = {
  id: string;
  title: string;
  projectId: string;
  project: string;
  provider: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  archived: boolean;
  needsAttention: boolean;
  queuedWork: "none" | "waiting" | "failed";
  scheduledSendAt: number | null;
  waitingForThreadIds: string[];
  status: string;
  backgroundWork: number;
  children: NativeChildThread[];
};

export const rpcContract = defineRpcContract({
  wait_dependencies: {
    input: z.object({}).strict(),
    output: z
      .object({
        scheduledSends: z.array(
          z.object({ threadId: z.string(), sendAt: z.number() }).strict(),
        ),
        dependencies: z.array(
          z
            .object({
              waitingThreadId: z.string(),
              targetThreadIds: z.array(z.string()),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  toggle_archived: {
    input: z.object({ id: z.string().min(1).max(100) }).strict(),
    output: z.object({ archived: z.boolean() }).strict(),
  },
  workout_scratchpad: {
    input: z
      .object({
        legacyContent: z.string().max(MAX_WORKOUT_SCRATCHPAD_LENGTH).optional(),
      })
      .strict(),
    output: z
      .object({ content: z.string().max(MAX_WORKOUT_SCRATCHPAD_LENGTH) })
      .strict(),
  },
  save_workout_scratchpad: {
    input: z
      .object({ content: z.string().max(MAX_WORKOUT_SCRATCHPAD_LENGTH) })
      .strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  hidden_child_threads: {
    input: z.object({}).strict(),
    output: z
      .object({ threads: z.array(hiddenChildThreadSchema) })
      .strict(),
  },
  close_side_chat: {
    input: z.object({ threadId: z.string().min(1).max(100) }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  active_threadflow_wait: {
    input: z.object({ threadId: z.string().min(1).max(100) }).strict(),
    output: z
      .object({
        wait: activeThreadflowWaitSchema.nullable(),
        queuedWait: queuedThreadWaitSchema.nullable(),
      })
      .strict(),
  },
});

export type HiddenChildThread = z.infer<typeof hiddenChildThreadSchema>;
export type QueuedThreadWait = z.infer<typeof queuedThreadWaitSchema>;
