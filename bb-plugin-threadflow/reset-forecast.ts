import { z } from "zod";

const percent = z.number().min(0).max(100);
export const resetForecastSchema = z.object({
  mode: z.string().optional(),
  updated_at: z.iso.datetime(),
  probabilities: z.object({ rounded_24h: percent }),
  official_signal: z.object({
    window: z.object({
      end_at: z.iso.datetime(),
      target_at: z.iso.datetime().nullish(),
      target_kind: z.string().optional(),
    }).nullish(),
  }).nullish(),
});

export type ResetForecastResult =
  | { status: "ok"; forecast: z.infer<typeof resetForecastSchema> }
  | { status: "unavailable" };

// Run in the browser so requests use its TLS stack, including encrypted ClientHello.
// Only coalesce concurrent requests; every page load or click gets fresh data.
export function createResetForecastLoader() {
  let inFlight: Promise<ResetForecastResult> | undefined;
  return (): Promise<ResetForecastResult> => {
    if (inFlight) return inFlight;
    inFlight = (async (): Promise<ResetForecastResult> => {
      try {
        const response = await fetch("https://codex-reset.com/api/forecast", {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`Forecast HTTP ${response.status}`);
        const forecast = resetForecastSchema.parse(await response.json());
        return { status: "ok", forecast };
      } catch {
        return { status: "unavailable" };
      }
    })().then((result) => {
      inFlight = undefined;
      return result;
    });
    return inFlight;
  };
}

export function formatResetForecast(
  forecast: z.infer<typeof resetForecastSchema>,
  now = new Date(),
  timeZone?: string,
): string {
  const window = forecast.official_signal?.window;
  if (forecast.mode === "announced" && window?.target_at && Date.parse(window.end_at) > now.getTime()) {
    const target = new Date(window.target_at);
    const dateOptions = { timeZone, month: "short", day: "numeric" } as const;
    const day = target.toLocaleDateString("en-US", dateOptions);
    const date = day === now.toLocaleDateString("en-US", dateOptions) ? "" : `${day}, `;
    const time = target.toLocaleTimeString("en-US", {
      timeZone, hour: "numeric", minute: "2-digit",
      timeZoneName: "short",
    }).replace(":00", "");
    const qualifier = window.target_kind === "deadline" ? "by " : "~";
    return `Codex reset: expected ${qualifier}${date}${time}`;
  }
  return `Codex reset: ${forecast.probabilities.rounded_24h}% chance in next 24h`;
}
