import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const threadIdSchema = z.string().regex(/^thr_[a-z0-9]{1,64}$/);

export const devServerStateSchema = z.enum([
  // The thread has no checkout with a ./dev.sh launcher.
  "unavailable",
  "stopped",
  "starting",
  "ready",
  "stopping",
  // The last launcher run from this plugin exited with an error.
  "failed",
]);
export type DevServerState = z.infer<typeof devServerStateSchema>;

export const devServerStatusSchema = z
  .object({
    state: devServerStateSchema,
    environmentId: z.string().nullable(),
    url: z.string().nullable(),
    /** Terminal running the launcher when this thread can show it. */
    terminalId: z.string().nullable(),
    /** Checkout-relative log file to show when there is no terminal to reveal. */
    logPath: z.string().nullable(),
    /** Running, but not from a terminal this plugin started. */
    external: z.boolean(),
    exitCode: z.number().nullable(),
  })
  .strict();
export type DevServerStatus = z.infer<typeof devServerStatusSchema>;

const threadInput = z.object({ threadId: threadIdSchema }).strict();
const threadTag = (threadId: string) => [`thread:${threadId}`];

export const rpcContract = defineRpcContract({
  status: {
    input: z.object({ keys: z.array(threadIdSchema).max(32) }).strict(),
    output: z.record(z.string(), devServerStatusSchema),
    keyTags: (key) => threadTag(key),
  },
  start: {
    input: threadInput,
    output: z.object({ terminalId: z.string() }).strict(),
    invalidates: ({ threadId }) => threadTag(threadId),
  },
  stop: {
    input: threadInput,
    output: z.object({ stopped: z.boolean() }).strict(),
    invalidates: ({ threadId }) => threadTag(threadId),
  },
  open: {
    input: threadInput,
    /** False when no BB desktop window can show it; the client falls back to openUrl. */
    output: z.object({ opened: z.boolean() }).strict(),
  },
  restart: {
    input: threadInput,
    output: z.object({ terminalId: z.string() }).strict(),
    invalidates: ({ threadId }) => threadTag(threadId),
  },
});
