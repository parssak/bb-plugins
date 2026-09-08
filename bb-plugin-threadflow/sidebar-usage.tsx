import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { createResetForecastLoader, formatResetForecast, type ResetForecastResult } from "./reset-forecast";
import { parseUsageSamples, type TodayUsageEstimate, type UsageSample } from "./usage-tracking";

const LEGACY_USAGE_SAMPLES_STORAGE_KEY = "threadflow:codex-usage-samples:v1";
const MAX_LEGACY_USAGE_SAMPLES = 2_048;

type CodexUsage =
  | {
    status: "ok";
    planLabel: string | null;
    windows: Array<{ label: string; resetsAt: string | null; usedPercent: number }>;
    todayUsage: TodayUsageEstimate | null;
  }
  | { status: "unavailable"; message: string };

function formatUsageReset(resetsAt: string | null): string | null {
  if (resetsAt === null) return null;
  const remainingMs = Date.parse(resetsAt) - Date.now();
  if (!Number.isFinite(remainingMs)) return null;
  if (remainingMs <= 0) return "resetting";
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.ceil(hours / 24)}d`;
}

function localDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatTodayUsage(usedPercent: number): string {
  return `${Math.round(usedPercent)}% today`;
}

const loadResetForecast = createResetForecastLoader();

export function SidebarFooter() {
  const [result, setResult] = useState<ResetForecastResult | null>(null);
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);

  const refreshForecast = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    try {
      const next = await loadResetForecast();
      if (mounted.current) setResult(next);
    } finally {
      pending.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const forecast = result?.status === "ok" ? result.forecast : null;
  const label = loading ? "Codex reset: checking…"
    : forecast ? formatResetForecast(forecast) : "Codex reset: unavailable";

  const rpc = useRpc<typeof rpcContract>();
  const [usage, setUsage] = useState<CodexUsage | null>(null);
  const usageRefreshInFlight = useRef(false);
  const legacyUsageSamples = useRef<UsageSample[] | null>(null);

  const refresh = useCallback(async () => {
    if (usageRefreshInFlight.current) return;
    usageRefreshInFlight.current = true;
    try {
      if (legacyUsageSamples.current === null) {
        try {
          legacyUsageSamples.current = parseUsageSamples(
            window.localStorage.getItem(LEGACY_USAGE_SAMPLES_STORAGE_KEY),
          ).slice(-MAX_LEGACY_USAGE_SAMPLES);
        } catch {
          legacyUsageSamples.current = [];
        }
      }
      const now = Date.now();
      const result = await rpc.call("codex_usage", {
        dayStartedAt: localDayStart(now),
        ...(legacyUsageSamples.current.length === 0
          ? {}
          : { legacySamples: legacyUsageSamples.current }),
      });
      setUsage(result);
      if (result.status === "ok") {
        legacyUsageSamples.current = [];
        try {
          window.localStorage.removeItem(LEGACY_USAGE_SAMPLES_STORAGE_KEY);
        } catch {
          // The shared server history is authoritative even if legacy cleanup fails.
        }
      }
    } catch {
      setUsage({ status: "unavailable", message: "Codex usage unavailable" });
    } finally {
      usageRefreshInFlight.current = false;
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10 * 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      const now = Date.now();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 0);
      timer = window.setTimeout(() => {
        void refresh();
        schedule();
      }, nextMidnight.getTime() - now + 1_000);
    };
    schedule();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refresh]);

  const weeklyWindow = usage?.status === "ok"
    ? usage.windows.find((window) => /week|7\s*d/i.test(window.label)) ?? usage.windows.at(-1) ?? null
    : null;

  if (weeklyWindow === null) return null;

  const usedPercent = Math.min(100, Math.max(0, weeklyWindow.usedPercent));
  const todayUsage = usage?.status === "ok" ? usage.todayUsage : null;
  const todayWidth = todayUsage === null ? 0 : Math.min(usedPercent, todayUsage.usedPercent);
  const reset = formatUsageReset(weeklyWindow.resetsAt);

  return (
    <div className="shrink-0 space-y-1.5 px-3.5 py-2">
      {(loading || result !== null) && (
        <div
          role="status"
          title={forecast ? `Updated ${new Date(forecast.updated_at).toLocaleString()}` : undefined}
          className="text-[10px] text-muted-foreground/80"
        >
          {label}
        </div>
      )}
      <button
        type="button"
        onClick={() => void refreshForecast()}
        disabled={loading}
        aria-label="Fetch Codex reset forecast"
        title="Click to fetch reset forecast"
        className="block w-full space-y-0.5 text-left disabled:cursor-wait"
      >
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/80">
          <span className="truncate">Usage</span>
          <span className="shrink-0 pl-2">
            {todayUsage === null ? "Today unavailable" : `${todayUsage.coverage === "partial-day" ? "≥" : ""}${formatTodayUsage(todayUsage.usedPercent)}`} • {Math.round(100 - usedPercent)}% left
            {reset === null ? "" : ` • ${reset}`}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={`${weeklyWindow.label} usage`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(usedPercent)}
          className="relative h-1 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-foreground/30" style={{ width: `${usedPercent}%` }} />
          {todayUsage === null || todayWidth === 0 ? null : (
            <div
              className="absolute top-0 h-full bg-foreground/65"
              style={{ left: `${usedPercent - todayWidth}%`, width: `${todayWidth}%` }}
              title={formatTodayUsage(todayWidth)}
            />
          )}
        </div>
      </button>
    </div>
  );
}
