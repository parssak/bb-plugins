import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { activeThreadflowWaitSchema } from "./wait-service.ts";

const MAX_WORKOUT_SCRATCHPAD_LENGTH = 4_000;

const sideChatSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceThreadId: z.string(),
  createdAt: z.number(),
  needsAttention: z.boolean(),
  running: z.boolean(),
  closeable: z.boolean(),
  navigation: z.enum(["thread", "split"]),
});

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

const nativeThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectId: z.string(),
  project: z.string(),
  provider: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archivedAt: z.number().nullable(),
  archived: z.boolean(),
  needsAttention: z.boolean(),
  queuedWork: z.enum(["none", "waiting", "failed"]),
  scheduledSendAt: z.number().nullable(),
  waitingForThreadIds: z.array(z.string()),
  status: z.string(),
  sideChats: z.array(sideChatSchema),
});

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

export type NativeThread = z.infer<typeof nativeThreadSchema>;
export type NativeSideChat = z.infer<typeof sideChatSchema>;
export type QueuedThreadWait = z.infer<typeof queuedThreadWaitSchema>;
