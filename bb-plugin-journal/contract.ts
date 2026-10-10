import { journalAppearanceSchema } from "./journal-appearance.ts";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { isJournalDateKey } from "./journal-date.ts";

const MAX_JOURNAL_CONTENT_LENGTH = 100_000;

const journalDateKeySchema = z
  .string()
  .refine(isJournalDateKey, "Invalid local date");

export const rpcContract = defineRpcContract({
  journal_appearance: {
    input: z.object({}).strict(),
    output: journalAppearanceSchema,
  },
  save_journal_appearance: {
    input: journalAppearanceSchema,
    output: journalAppearanceSchema,
  },
  journal_entry: {
    input: z.object({ dateKey: journalDateKeySchema }).strict(),
    output: z
      .object({
        content: z.string().max(MAX_JOURNAL_CONTENT_LENGTH).nullable(),
      })
      .strict(),
  },
  journal_chat: {
    input: z.object({ dateKey: journalDateKeySchema }).strict(),
    output: z.object({ threadId: z.string() }).strict(),
  },
  save_journal_entry: {
    input: z
      .object({
        dateKey: journalDateKeySchema,
        content: z.string().max(MAX_JOURNAL_CONTENT_LENGTH),
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  journal_thread_statuses: {
    input: z
      .object({
        threadIds: z.array(z.string().min(1).max(100)).max(100),
      })
      .strict(),
    output: z
      .object({
        statuses: z
          .array(
            z
              .object({
                threadId: z.string(),
                status: z.enum(["archived", "in-progress"]),
              })
              .strict(),
          )
          .max(100),
      })
      .strict(),
  },
});
