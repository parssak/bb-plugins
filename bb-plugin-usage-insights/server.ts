import { registerLegacyImport } from "./legacy-storage.ts";
import {
  rpcContract,
  type UsageProviderId,
  type UsageResult,
} from "./contract.ts";
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

  const readUsage = async (
    providerId: UsageProviderId,
    dayStartedAt: number,
    legacySamples: UsageSample[] = [],
  ): Promise<UsageResult> => {
    const displayName = providerId === "codex" ? "Codex" : "Claude Code";
    const storageKey =
      providerId === "codex"
        ? USAGE_SAMPLES_KEY
        : "usage:claude-code:samples:v1";
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let usage: Awaited<ReturnType<typeof bb.sdk.system.usageLimits>> | null;
    try {
      usage = await Promise.race([
        bb.sdk.system.usageLimits({ providerId }),
        new Promise<null>((resolve) => {
          timeout = setTimeout(() => resolve(null), 4_000);
        }),
      ]).finally(() => {
        if (timeout !== undefined) clearTimeout(timeout);
      });
    } catch {
      return {
        status: "unavailable",
        message: `${displayName} usage unavailable`,
      };
    }
    if (usage === null) {
      return {
        status: "unavailable" as const,
        message: `${displayName} usage timed out`,
      };
    }
    const providerUsage = usage[providerId];
    if (providerUsage?.status === "ok") {
      const windows = providerUsage.windows.map(
        ({ label, resetsAt, usedPercent }) => ({
          label,
          resetsAt,
          usedPercent,
        }),
      );
      const weeklyWindow =
        windows.find((window) => /week|7\s*d/i.test(window.label)) ?? null;
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
                await bb.storage.kv.get<unknown>(storageKey),
                providerId === "codex" ? legacySamples : [],
                current.observedAt,
              );
              const estimate = calculateTodayUsedPercent({
                samples,
                current,
                dayStartedAt,
              });
              await bb.storage.kv.set(
                storageKey,
                appendUsageSample(samples, current),
              );
              return estimate;
            });
      return {
        status: "ok" as const,
        planLabel: providerUsage.planLabel,
        windows,
        todayUsage,
      };
    }
    const message =
      providerUsage?.status === "error"
        ? providerUsage.message
        : providerUsage?.status === "unauthenticated" ||
            providerUsage?.status === "expired"
          ? `Sign in to ${displayName} to see usage`
          : providerUsage?.status === "not_installed"
            ? `${displayName} is not installed`
            : `${displayName} usage unavailable`;
    return { status: "unavailable" as const, message };
  };
  bb.rpc.register(rpcContract, {
    provider_usage: ({ providerId, dayStartedAt, legacySamples }) =>
      readUsage(providerId, dayStartedAt, legacySamples),
    codex_usage: ({ dayStartedAt, legacySamples }) =>
      readUsage("codex", dayStartedAt, legacySamples),
  });
}
