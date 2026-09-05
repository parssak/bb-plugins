import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBrowserDimmingModal } from "./hooks/useBrowserDimmingModal";

const SWITCH_WINDOW_MS = 2 * 60_000;
const SWITCH_THRESHOLD = 16;
const DISMISS_COOLDOWN_MS = 15 * 60_000;
const WORKOUT_SCRATCHPAD_KEY = "threadflow:workout-scratchpad";
const CALM_VIDEO_URLS = [
  "https://upload.wikimedia.org/wikipedia/commons/transcoded/2/29/Sunny_waves_at_Cattle_Point_%2840789227201%29.webm/Sunny_waves_at_Cattle_Point_%2840789227201%29.webm.480p.vp9.webm",
  "https://upload.wikimedia.org/wikipedia/commons/transcoded/7/7d/DJI_0147_Soothing_South_Coast_Waves.webm/DJI_0147_Soothing_South_Coast_Waves.webm.480p.vp9.webm",
  "https://upload.wikimedia.org/wikipedia/commons/e/e9/Free_Creative_Commons_Stock_video_-_Time_lapse_clouds.webm",
] as const;

type ThreadSwitch = {
  threadId: string;
  at: number;
};

export function ContextSwitchGuard({ activeThreadId }: { activeThreadId: string | null }) {
  const previousThreadId = useRef<string | null>(activeThreadId);
  const switches = useRef<ThreadSwitch[]>([]);
  const cooldownUntil = useRef(0);
  const [visibleSwitchCount, setVisibleSwitchCount] = useState<number | null>(null);
  const [videoIndex, setVideoIndex] = useState(() => Math.floor(Math.random() * CALM_VIDEO_URLS.length));
  const [scratchpad, setScratchpad] = useState(() => {
    try {
      return window.localStorage.getItem(WORKOUT_SCRATCHPAD_KEY) ?? "";
    } catch {
      return "";
    }
  });
  useBrowserDimmingModal(visibleSwitchCount !== null);

  useEffect(() => {
    try {
      window.localStorage.setItem(WORKOUT_SCRATCHPAD_KEY, scratchpad);
    } catch {
      // The scratchpad still works for this session when storage is unavailable.
    }
  }, [scratchpad]);

  const dismiss = useCallback(() => {
    setVisibleSwitchCount(null);
    switches.current = [];
    cooldownUntil.current = Date.now() + DISMISS_COOLDOWN_MS;
  }, []);

  useEffect(() => {
    if (activeThreadId === null || activeThreadId === previousThreadId.current) return;
    previousThreadId.current = activeThreadId;

    const now = Date.now();
    switches.current = [
      ...switches.current.filter((entry) => now - entry.at <= SWITCH_WINDOW_MS),
      { threadId: activeThreadId, at: now },
    ];
    if (
      now >= cooldownUntil.current
      && switches.current.length >= SWITCH_THRESHOLD
    ) {
      setVideoIndex((current) => (current + 1) % CALM_VIDEO_URLS.length);
      setVisibleSwitchCount(switches.current.length);
    }
  }, [activeThreadId]);

  useEffect(() => {
    if (visibleSwitchCount === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [dismiss, visibleSwitchCount]);

  if (visibleSwitchCount === null) return null;
  return createPortal(
    <div
      data-bb-plugin="threadflow"
      role="dialog"
      aria-modal="true"
      aria-labelledby="context-switch-guard-title"
      className="fixed inset-0 z-[1000] grid overflow-hidden bg-slate-950 p-6 text-white"
    >
      <video
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        src={CALM_VIDEO_URLS[videoIndex]}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-0 bg-black/30" />
      <div className="relative m-auto w-full max-w-md rounded-2xl bg-black/40 px-8 py-7 text-center shadow-2xl backdrop-blur-xl">
        <h2 id="context-switch-guard-title" className="text-2xl font-normal text-white">
          Take a breather.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-white/80">
          You switched threads {visibleSwitchCount} times in under two minutes. Step away for a minute before opening another one.
        </p>
        <label htmlFor="context-switch-workout-scratchpad" className="mt-5 block text-left text-xs font-medium text-white/70">
          Pushups / pullups scratchpad
        </label>
        <textarea
          id="context-switch-workout-scratchpad"
          value={scratchpad}
          onChange={(event) => setScratchpad(event.target.value)}
          maxLength={4_000}
          rows={5}
          placeholder={"Pushups: 30\nPullups: 8\nNotes: weak and shameful"}
          className="mt-2 w-full resize-y rounded-md border border-white/20 bg-black/35 px-3 py-2 text-left font-mono text-sm leading-relaxed text-white outline-none placeholder:text-white/35 focus:border-white/50 focus:ring-1 focus:ring-white/30"
        />
        <button
          type="button"
          autoFocus
          onClick={dismiss}
          className="mt-6 rounded-md border border-white/20 bg-white/90 px-4 py-2 text-sm text-black outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-white"
        >
          Got it
        </button>
      </div>
    </div>,
    document.body,
  );
}
