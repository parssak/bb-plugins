// Pure parsing and state derivation, kept free of BB APIs so it is easy to test.
import type { DevServerState } from "./contract.ts";

/** What `./dev.sh` saves in `.dev/environment.json` (usebogi.com's launcher). */
export interface SavedEnvironment {
  url: string;
  sitePort: number | null;
  logPath: string | null;
}

export function parseSavedEnvironment(
  text: string,
  checkoutPath: string,
): SavedEnvironment | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  // A copied .dev directory belongs to another checkout; its URL is not ours.
  if (typeof record.root === "string" && record.root !== checkoutPath) return null;
  const url = httpUrl(record.url);
  if (url === null) return null;
  const ports = record.ports as Record<string, unknown> | undefined;
  const site = ports?.site;
  const log = record.log;
  return {
    url,
    sitePort: validPort(site) ? site : portOf(url),
    logPath:
      typeof log === "string" && log.startsWith(`${checkoutPath}/`)
        ? log.slice(checkoutPath.length + 1)
        : null,
  };
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "").replace(/\r/g, "");
}

// usebogi.com prints both once the site, backend and sandbox are all up.
const READY = /all services ready|^\s*\S+ is ready\s*$/im;
const URL_LINES = [
  /^\s*Open:\s*(https?:\/\/\S+)/im,
  /^\s*Development URL:\s*(https?:\/\/\S+)/im,
  /^\s*-?\s*Local:\s*(https?:\/\/\S+)/im,
];

export interface OutputScan {
  ready: boolean;
  url: string | null;
}

/** Find the launcher's readiness banner and announced URL in terminal output. */
export function scanOutput(text: string): OutputScan {
  const plain = stripAnsi(text);
  let url: string | null = null;
  for (const pattern of URL_LINES) {
    const match = pattern.exec(plain);
    if (match?.[1]) {
      url = httpUrl(match[1]);
      if (url !== null) break;
    }
  }
  return { ready: READY.test(plain), url };
}

export interface RunSnapshot {
  /** Our terminal's state, or null when this plugin is not running one. */
  terminal: { status: "starting" | "running" | "exited" | "disconnected"; exitCode: number | null } | null;
  stopping: boolean;
  readySeen: boolean;
  portOpen: boolean;
}

// Interrupt, hangup and terminate are how a dev server normally stops.
const CLEAN_EXITS = new Set([0, 129, 130, 143]);

export function deriveState(snapshot: RunSnapshot): { state: DevServerState; external: boolean } {
  const { terminal } = snapshot;
  const ours = terminal !== null && (terminal.status === "running" || terminal.status === "starting");
  if (snapshot.stopping && (ours || snapshot.portOpen)) return { state: "stopping", external: !ours };
  if (ours) {
    return { state: snapshot.readySeen || snapshot.portOpen ? "ready" : "starting", external: false };
  }
  if (snapshot.portOpen) return { state: "ready", external: true };
  if (terminal?.status === "exited" && terminal.exitCode !== null && !CLEAN_EXITS.has(terminal.exitCode)) {
    return { state: "failed", external: false };
  }
  return { state: "stopped", external: false };
}

export function shellArgs(raw: string): string[] {
  return raw.split(/\s+/).filter((part) => part !== "");
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

function portOf(url: string): number | null {
  const parsed = new URL(url);
  if (parsed.port !== "") return Number(parsed.port);
  return null;
}

function validPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536;
}
