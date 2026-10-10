import { registerLegacyImport } from "./legacy-storage.ts";
import { rpcContract } from "./contract.ts";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  appendUsageSample,
  calculateTodayUsedPercent,
  type UsageSample,
} from "./usage-tracking.ts";

const USAGE_SAMPLES_KEY = "usage:samples:v1";

const usageSampleSchema = z
  .object({
    observedAt: z.number().int().nonnegative(),
    resetsAt: z.string().nullable(),
    usedPercent: z.number().min(0).max(100),
  })
  .strict();

function validUsageSamples(value: unknown, observedAt: number): UsageSample[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const parsed = usageSampleSchema.safeParse(candidate);
    return parsed.success && parsed.data.observedAt <= observedAt
      ? [parsed.data]
      : [];
  });
}

function mergeUsageSamples(
  stored: unknown,
  legacy: readonly UsageSample[],
  observedAt: number,
): UsageSample[] {
  const sorted = [
    ...validUsageSamples(stored, observedAt),
    ...validUsageSamples(legacy, observedAt),
  ].sort((left, right) => left.observedAt - right.observedAt);
  return sorted.filter((sample, index) => {
    const previous = sorted[index - 1];
    return (
      previous === undefined ||
      previous.resetsAt !== sample.resetsAt ||
      previous.usedPercent !== sample.usedPercent
    );
  });
}

export default function plugin(bb: BbPluginApi) {
  registerLegacyImport(bb, "usage", (key, value) => {
    z.array(usageSampleSchema).max(2048).parse(value);
  });
  let kvMutationTail = Promise.resolve();
  const serializeKvMutation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = kvMutationTail.then(operation, operation);
    kvMutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  bb.rpc.register(rpcContract, {
    codex_usage: async ({ dayStartedAt, legacySamples = [] }) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const usage = await Promise.race([
        bb.sdk.system.usageLimits({ providerId: "codex" }),
        new Promise<null>((resolve) => {
          timeout = setTimeout(() => resolve(null), 4_000);
        }),
      ]).finally(() => {
        if (timeout !== undefined) clearTimeout(timeout);
      });
      if (usage === null) {
        return {
          status: "unavailable" as const,
          message: "Codex usage timed out",
        };
      }
      const codexUsage = usage.codex;
      if (codexUsage?.status === "ok") {
        const windows = codexUsage.windows.map(
          ({ label, resetsAt, usedPercent }) => ({
            label,
            resetsAt,
            usedPercent,
          }),
        );
        const weeklyWindow =
          windows.find((window) => /week|7\s*d/i.test(window.label)) ??
          windows.at(-1) ??
          null;
        const todayUsage =
          weeklyWindow === null
            ? null
            : await serializeKvMutation(async () => {
                const current: UsageSample = {
                  observedAt: Date.now(),
                  resetsAt: weeklyWindow.resetsAt,
                  usedPercent: weeklyWindow.usedPercent,
                };
                const samples = mergeUsageSamples(
                  await bb.storage.kv.get<unknown>(USAGE_SAMPLES_KEY),
                  legacySamples,
                  current.observedAt,
                );
                const estimate = calculateTodayUsedPercent({
                  samples,
                  current,
                  dayStartedAt,
                });
                await bb.storage.kv.set(
                  USAGE_SAMPLES_KEY,
                  appendUsageSample(samples, current),
                );
                return estimate;
              });
        return {
          status: "ok" as const,
          planLabel: codexUsage.planLabel,
          windows,
          todayUsage,
        };
      }
      const message =
        codexUsage?.status === "error"
          ? codexUsage.message
          : codexUsage?.status === "unauthenticated" ||
              codexUsage?.status === "expired"
            ? "Sign in to Codex to see usage"
            : "Codex usage unavailable";
      return { status: "unavailable" as const, message };
    },
  });
}
