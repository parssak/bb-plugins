import { z } from "zod";

const percent = z.number().min(0).max(100);
export const resetForecastSchema = z.object({
  updated_at: z.iso.datetime(),
  probabilities: z.object({ rounded_24h: percent, rounded_48h: percent }),
  confidence: z.string().max(100),
  confidence_note: z.string().max(1_000).nullish(),
  official_signal: z.object({
    window: z.object({
      label: z.string().max(200),
      end_at: z.iso.datetime(),
    }).nullish(),
  }).nullish(),
});

export const resetForecastResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), forecast: resetForecastSchema }),
  z.object({ status: z.literal("unavailable") }),
]);
export type ResetForecastResult = z.infer<typeof resetForecastResultSchema>;

// Share one request/cache across sidebar clients; never present a failed refresh as fresh.
export function createResetForecastLoader() {
  let cached: ResetForecastResult | undefined;
  let expiresAt = 0;
  let inFlight: Promise<ResetForecastResult> | undefined;
  return (): Promise<ResetForecastResult> => {
    if (cached && Date.now() < expiresAt) return Promise.resolve(cached);
    if (inFlight) return inFlight;
    inFlight = (async (): Promise<ResetForecastResult> => {
      try {
        const response = await fetch("https://codex-reset.com/api/forecast", {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`Forecast HTTP ${response.status}`);
        const forecast = resetForecastSchema.parse(await response.json());
        return { status: "ok", forecast };
      } catch {
        return { status: "unavailable" };
      }
    })().then((result) => {
      cached = result;
      expiresAt = Date.now() + (result.status === "ok" ? 5 * 60_000 : 60_000);
      inFlight = undefined;
      return result;
    });
    return inFlight;
  };
}
