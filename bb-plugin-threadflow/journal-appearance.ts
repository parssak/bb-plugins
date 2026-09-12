import { z } from "zod";

export const journalAppearanceSchema = z.object({
  letterSpacing: z.number().min(-1).max(3),
  lineHeight: z.number().min(1.2).max(2.5),
  topPadding: z.number().min(0).max(200),
  fontSize: z.number().min(12).max(24),
  documentWidth: z.number().min(480).max(1200),
  paragraphSpacing: z.number().min(0).max(2),
  listSpacing: z.number().min(0).max(2).default(1),
  listItemSpacing: z.number().min(0).max(1).default(0.35),
}).strict();
export type JournalAppearance = z.infer<typeof journalAppearanceSchema>;
export const DEFAULT_JOURNAL_APPEARANCE: JournalAppearance = {
  letterSpacing: 0, lineHeight: 1.75, topPadding: 12,
  fontSize: 16, documentWidth: 768, paragraphSpacing: 1,
  listSpacing: 1, listItemSpacing: 0.35,
};
export const JOURNAL_APPEARANCE_KEY = "journal-appearance:v1";
export const JOURNAL_APPEARANCE_CHANNEL = "journal-appearance-changed";
