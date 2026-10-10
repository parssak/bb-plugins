import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, UsageProviderId, UsageResult } from "./contract";
import {
  createResetForecastLoader,
  formatResetForecast,
  type ResetForecastResult,
} from "./reset-forecast";
import { parseUsageSamples, type UsageSample } from "./usage-tracking";

const LEGACY_USAGE_SAMPLES_STORAGE_KEY = "threadflow:codex-usage-samples:v1";
const PROVIDERS = [
  { id: "codex", label: "Codex" },
  { id: "claude-code", label: "Claude Code" },
] as const;

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

export function ProviderUsageCard({
  label,
  usage,
}: {
  label: string;
  usage: UsageResult | null;
}) {
  return (
    <section aria-label={`${label} usage`} className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        {usage?.status === "ok" && usage.planLabel ? (
          <span className="truncate text-muted-foreground">
            {usage.planLabel}
          </span>
        ) : null}
      </div>
      {usage === null ? (
        <p className="text-[10px] text-muted-foreground">Loading usage…</p>
      ) : usage.status === "unavailable" ? (
        <p role="status" className="text-[10px] text-muted-foreground">
          {usage.message}
        </p>
      ) : (
        <>
          {usage.windows.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">
              No usage limits reported
            </p>
          ) : null}
          {usage.windows.map((window, index) => {
            const usedPercent = Math.min(100, Math.max(0, window.usedPercent));
            const reset = formatUsageReset(window.resetsAt);
            return (
              <div key={`${window.label}:${index}`} className="space-y-1">
                <div className="flex justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>{window.label}</span>
                  <span className="shrink-0">
                    {Math.round(100 - usedPercent)}% left
                    {reset ? ` • ${reset}` : ""}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label={`${label} ${window.label} usage`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(usedPercent)}
                  className="h-1 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-foreground/40"
                    style={{ width: `${usedPercent}%` }}
                  />
                </div>
              </div>
            );
          })}
          {usage.todayUsage ? (
            <p
              className="text-[10px] text-muted-foreground"
              title="Change in weekly usage since local midnight. ≥ indicates tracking started during the day."
            >
              {usage.todayUsage.coverage === "partial-day" ? "≥" : ""}
              {Math.round(usage.todayUsage.usedPercent)}% today
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

const loadResetForecast = createResetForecastLoader();

export function SidebarFooter() {
  const rpc = useRpc<typeof rpcContract>();
  const [usage, setUsage] = useState<
    Record<UsageProviderId, UsageResult | null>
  >({ codex: null, "claude-code": null });
  const [forecastResult, setForecastResult] =
    useState<ResetForecastResult | null>(null);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const pendingForecast = useRef(false);
  const usageRefreshInFlight = useRef(false);
  const legacyUsageSamples = useRef<UsageSample[] | null>(null);
  const mounted = useRef(false);

  const refreshForecast = useCallback(async () => {
    if (pendingForecast.current) return;
    pendingForecast.current = true;
    setLoadingForecast(true);
    try {
      const next = await loadResetForecast();
      if (mounted.current) setForecastResult(next);
    } finally {
      pendingForecast.current = false;
      if (mounted.current) setLoadingForecast(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (usageRefreshInFlight.current) return;
    usageRefreshInFlight.current = true;
    try {
      if (legacyUsageSamples.current === null) {
        try {
          legacyUsageSamples.current = parseUsageSamples(
            window.localStorage.getItem(LEGACY_USAGE_SAMPLES_STORAGE_KEY),
          ).slice(-2_048);
        } catch {
          legacyUsageSamples.current = [];
        }
      }
      const samples = legacyUsageSamples.current;
      const dayStartedAt = localDayStart(Date.now());
      await Promise.all(
        PROVIDERS.map(async ({ id, label }) => {
          let result: UsageResult;
          try {
            result = await rpc.call("provider_usage", {
              providerId: id,
              dayStartedAt,
              ...(id === "codex" && samples.length
                ? { legacySamples: samples }
                : {}),
            });
            if (id === "codex" && result.status === "ok") {
              legacyUsageSamples.current = [];
              try {
                window.localStorage.removeItem(
                  LEGACY_USAGE_SAMPLES_STORAGE_KEY,
                );
              } catch {
                /* Server history is authoritative. */
              }
            }
          } catch {
            result = {
              status: "unavailable",
              message: `${label} usage unavailable`,
            };
          }
          if (mounted.current)
            setUsage((current) => ({ ...current, [id]: result }));
        }),
      );
    } finally {
      usageRefreshInFlight.current = false;
    }
  }, [rpc]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10 * 60_000);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      const now = Date.now();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 0);
      timer = window.setTimeout(
        () => {
          void refresh();
          schedule();
        },
        nextMidnight.getTime() - now + 1_000,
      );
    };
    schedule();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refresh]);

  const forecast =
    forecastResult?.status === "ok" ? forecastResult.forecast : null;
  return (
    <div className="shrink-0 space-y-4 px-3.5 py-2">
      {PROVIDERS.map(({ id, label }) => (
        <ProviderUsageCard key={id} label={label} usage={usage[id]} />
      ))}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          Refresh usage
        </button>
      </div>
      <div className="space-y-1 border-t border-border pt-2">
        <button
          type="button"
          onClick={() => void refreshForecast()}
          disabled={loadingForecast}
          aria-label="Fetch Codex reset forecast"
          className="text-[10px] text-muted-foreground hover:text-foreground disabled:cursor-wait"
        >
          {loadingForecast
            ? "Codex reset: checking…"
            : "Fetch Codex reset forecast"}
        </button>
        {forecastResult ? (
          <p
            role="status"
            title={
              forecast
                ? `Updated ${new Date(forecast.updated_at).toLocaleString()}`
                : undefined
            }
            className="text-[10px] text-muted-foreground"
          >
            {forecast
              ? formatResetForecast(forecast)
              : "Codex reset: unavailable"}
          </p>
        ) : null}
      </div>
    </div>
  );
}
