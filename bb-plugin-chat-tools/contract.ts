import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

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

const chatSummarySchema = z.object({
  threadId: z.string(),
  sourceUpdatedAt: z.number(),
  lastUserMessage: z.string(),
  summary: z.string(),
  followUps: z.array(z.string().trim().min(1).max(240)).max(3).optional(),
  dismissed: z.boolean(),
});

export const rpcContract = defineRpcContract({
  thread_context: {
    input: z.object({ threadId: z.string().min(1).max(100) }).strict(),
    output: z
      .object({
        target: z
          .object({
            id: z.string(),
            title: z.string(),
            createdAt: z.number(),
            project: z.string(),
            worktree: z.string().nullable(),
            sourceThreadId: z.string().optional(),
            accentTitle: z.string().optional(),
            accentCreatedAt: z.number().optional(),
          })
          .strict(),
      })
      .strict(),
  },
  toggle_archived: {
    input: z.object({ id: z.string().min(1).max(100) }).strict(),
    output: z.object({ archived: z.boolean() }).strict(),
  },
  prompt_history: {
    input: z.object({}).strict(),
    output: z
      .object({ prompts: z.array(z.string().min(1).max(4_000)).max(100) })
      .strict(),
  },
  user_message_timestamps: {
    input: z.object({ threadId: z.string().min(1).max(100) }).strict(),
    output: z
      .object({
        messages: z.array(
          z
            .object({
              rowIds: z.array(z.string().min(1)).min(1),
              createdAt: z.number(),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  create_side_chat: {
    input: z
      .object({
        sourceThreadId: z.string().min(1).max(100),
        initialMessage: z.string().trim().min(1).max(2_000).optional(),
        title: z.string().trim().min(1).max(80).optional(),
      })
      .strict(),
    output: z.object({ thread: sideChatSchema }).strict(),
  },
  create_automatic_review: {
    input: z.object({ sourceThreadId: z.string().min(1).max(100) }).strict(),
    output: z
      .object({ status: z.enum(["started", "already_claimed"]) })
      .strict(),
  },
  close_side_chat: {
    input: z.object({ threadId: z.string().min(1).max(100) }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  send_message: {
    input: z
      .object({
        threadId: z.string().min(1).max(100),
        message: z.string().trim().min(1).max(2_000),
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  handoff_side_chat: {
    input: z.object({ threadId: z.string().min(1).max(100) }).strict(),
    output: z.object({ status: z.enum(["started", "pending"]) }).strict(),
  },
  handoff_status: {
    input: z.object({ threadId: z.string().min(1).max(100) }).strict(),
    output: z.object({ pending: z.boolean() }).strict(),
  },
  pull_request_checks: {
    input: z.object({ threadId: z.string().min(1).max(100) }).strict(),
    output: z
      .object({
        checks: z
          .object({
            state: z.enum([
              "failing",
              "no_checks",
              "passing",
              "pending",
              "unknown",
            ]),
            failedCount: z.number().int().nonnegative(),
            pendingCount: z.number().int().nonnegative(),
            totalCount: z.number().int().nonnegative(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
  },
  worktree_changes: {
    input: z.object({ threadId: z.string().min(1).max(100) }).strict(),
    output: z
      .object({
        changes: z
          .object({
            baseBranch: z.string(),
            fileCount: z.number().int().nonnegative(),
            additions: z.number().int().nonnegative(),
            deletions: z.number().int().nonnegative(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
  },
  chat_summary: {
    input: z.object({ threadId: z.string().min(1).max(100) }).strict(),
    output: z.object({ summary: chatSummarySchema.nullable() }).strict(),
  },
  set_chat_summary_dismissed: {
    input: z
      .object({
        threadId: z.string().min(1).max(100),
        dismissed: z.boolean(),
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  toggle_chat_summary: {
    input: z.object({ threadId: z.string().min(1).max(100) }).strict(),
    output: z
      .object({ status: z.enum(["shown", "hidden", "started", "busy"]) })
      .strict(),
  },
  set_viewing_thread: {
    input: z
      .object({
        clientId: z.string().min(1).max(100),
        threadId: z.string().min(1).max(100).nullable(),
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
});
