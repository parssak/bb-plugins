import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const MAX_USAGE_SAMPLES = 2_048;

const usageWindowSchema = z
  .object({
    label: z.string(),
    resetsAt: z.string().nullable(),
    usedPercent: z.number().min(0).max(100),
  })
  .strict();

const usageSampleSchema = z
  .object({
    observedAt: z.number().int().nonnegative(),
    resetsAt: z.string().nullable(),
    usedPercent: z.number().min(0).max(100),
  })
  .strict();

const todayUsageSchema = z
  .object({
    coverage: z.enum(["full-day", "partial-day"]),
    usedPercent: z.number().min(0).max(100),
  })
  .strict();

export const rpcContract = defineRpcContract({
  codex_usage: {
    input: z
      .object({
        dayStartedAt: z.number().int().nonnegative(),
        legacySamples: z
          .array(usageSampleSchema)
          .max(MAX_USAGE_SAMPLES)
          .optional(),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("ok"),
          planLabel: z.string().nullable(),
          windows: z.array(usageWindowSchema),
          todayUsage: todayUsageSchema.nullable(),
        })
        .strict(),
      z
        .object({
          status: z.literal("unavailable"),
          message: z.string(),
        })
        .strict(),
    ]),
  },
});
