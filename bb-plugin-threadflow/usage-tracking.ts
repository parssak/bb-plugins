export type UsageSample = {
  observedAt: number;
  resetsAt: string | null;
  usedPercent: number;
};

export type TodayUsageEstimate = {
  coverage: "full-day" | "partial-day";
  usedPercent: number;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;
const MIDNIGHT_SAMPLE_GRACE_MS = 2 * 60 * 1_000;
const HISTORY_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1_000;
const MAX_SAMPLES = 2_048;

function isUsageSample(value: unknown): value is UsageSample {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<UsageSample>;
  return typeof candidate.observedAt === "number"
    && Number.isFinite(candidate.observedAt)
    && (candidate.resetsAt === null || typeof candidate.resetsAt === "string")
    && typeof candidate.usedPercent === "number"
    && Number.isFinite(candidate.usedPercent);
}

export function parseUsageSamples(value: string | null): UsageSample[] {
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isUsageSample) : [];
  } catch {
    return [];
  }
}

export function appendUsageSample(
  samples: readonly UsageSample[],
  sample: UsageSample,
): UsageSample[] {
  const cutoff = sample.observedAt - HISTORY_MAX_AGE_MS;
  return [...samples.filter((candidate) => candidate.observedAt >= cutoff), sample].slice(-MAX_SAMPLES);
}

export function calculateTodayUsedPercent({
  samples,
  current,
  dayStartedAt,
}: {
  samples: readonly UsageSample[];
  current: UsageSample;
  dayStartedAt: number;
}): TodayUsageEstimate {
  const matching = samples
    .filter((sample) => sample.resetsAt === current.resetsAt)
    .sort((a, b) => a.observedAt - b.observedAt);
  const midnightSample = matching.find((sample) => (
    sample.observedAt >= dayStartedAt
    && sample.observedAt <= dayStartedAt + MIDNIGHT_SAMPLE_GRACE_MS
  ));
  const previousSample = matching.filter((sample) => sample.observedAt < dayStartedAt).at(-1);
  const firstTodaySample = matching.find((sample) => sample.observedAt >= dayStartedAt);

  let baseline = midnightSample?.usedPercent ?? previousSample?.usedPercent ?? null;
  let coverage: TodayUsageEstimate["coverage"] = "full-day";
  const resetAt = current.resetsAt === null ? Number.NaN : Date.parse(current.resetsAt);
  const windowStartedAt = resetAt - WEEK_MS;
  if (Number.isFinite(windowStartedAt) && windowStartedAt >= dayStartedAt && windowStartedAt <= current.observedAt) {
    baseline = 0;
  }
  if (baseline === null) {
    baseline = firstTodaySample?.usedPercent ?? current.usedPercent;
    coverage = current.observedAt <= dayStartedAt + MIDNIGHT_SAMPLE_GRACE_MS ? "full-day" : "partial-day";
  }
  return {
    coverage,
    usedPercent: Math.min(100, Math.max(0, current.usedPercent - baseline)),
  };
}
