// Dev Server: run a checkout's ./dev.sh in a BB terminal and surface its URL.
//
// Each run is one command terminal scoped to the thread that started it, so
// BB's terminal panel shows its logs and closing that tab stops it. Status is
// per environment: every thread on the same checkout sees the same server.
import { connect } from "node:net";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createDevServerCli } from "./cli.ts";
import {
  rpcContract,
  threadIdSchema,
  type DevServerStatus,
} from "./contract.ts";
import {
  deriveState,
  parseSavedEnvironment,
  scanOutput,
  shellArgs,
  stripAnsi,
  type RunSnapshot,
} from "./dev-state.ts";

export { rpcContract } from "./contract.ts";

const LAUNCHER = "dev.sh";
const STOPPER = "kill-dev.sh";
const SAVED_ENVIRONMENT = ".dev/environment.json";
const CHECKOUT_TTL_MS = 15_000;
const STOP_GRACE_MS = 20_000;
const SCAN_CARRY_CHARS = 4_096;
const FIRST_SCAN_BYTES = 256 * 1024;

interface RunRecord {
  terminalId: string;
  threadId: string;
  startedAt: number;
  /** The app was opened in BB's browser once this run became ready. */
  browserOpened?: boolean;
}

interface Checkout {
  environmentId: string;
  hostId: string;
  path: string;
  /** On the server's own machine, so its ports can be probed directly. */
  local: boolean;
  hasLauncher: boolean;
}

type TerminalSnapshot = NonNullable<RunSnapshot["terminal"]>;

interface Scan {
  nextSeq: number;
  carry: string;
  ready: boolean;
  url: string | null;
}

const extraArgsSchema = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9 _=.,:/@+-]*$/, "Use plain flags such as --portless; shell syntax is not allowed.");

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    extraArgs: {
      type: "string",
      label: "Extra ./dev.sh arguments",
      description: "Appended to every run, for example --portless.",
      experimental_schema: extraArgsSchema,
      default: "",
    },
    showLogsOnStart: {
      type: "boolean",
      label: "Show logs when starting",
      description: "Reveal the dev.sh terminal in the side panel after Run dev.",
      default: true,
    },
    openBrowserWhenReady: {
      type: "boolean",
      label: "Open the app when ready",
      description: "Show the worktree in BB's side browser once a run started here is ready.",
      default: true,
    },
  });

  const lifetime = new AbortController();
  bb.onDispose(() => lifetime.abort());

  const checkouts = new Map<string, { at: number; value: Checkout | null }>();
  const scans = new Map<string, Scan>();
  const stopping = new Map<string, Promise<void>>();
  const locks = new Map<string, Promise<unknown>>();
  // Threads whose status was read, so a change to a shared checkout refreshes all of them.
  const watchers = new Map<string, Set<string>>();
  const lastServed = new Map<string, string>();
  const autoOpening = new Set<string>();
  let primaryHostId: Promise<string | null> | null = null;

  const runKey = (environmentId: string) => `run:${environmentId}`;

  function invalidateEnvironment(environmentId: string) {
    const threads = watchers.get(environmentId);
    if (threads && threads.size > 0) {
      bb.rpc.experimental_invalidate([...threads].map((threadId) => `thread:${threadId}`));
    }
  }

  async function withLock<T>(environmentId: string, run: () => Promise<T>): Promise<T> {
    const previous = locks.get(environmentId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    locks.set(environmentId, next);
    try {
      return await next;
    } finally {
      if (locks.get(environmentId) === next) locks.delete(environmentId);
    }
  }

  async function readText(hostId: string, path: string): Promise<string | null> {
    try {
      const file = await bb.sdk.files.read({ hostId, path });
      return file.contentEncoding === "base64"
        ? Buffer.from(file.content, "base64").toString("utf8")
        : file.content;
    } catch {
      return null;
    }
  }

  function primaryHost(): Promise<string | null> {
    primaryHostId ??= bb.sdk.system.config().then(
      (config) => config.primaryHostId,
      () => null,
    );
    return primaryHostId;
  }

  async function localHost(hostId: string): Promise<boolean> {
    return (await primaryHost()) === hostId;
  }

  async function checkoutFor(threadId: string, fresh = false): Promise<Checkout | null> {
    const cached = checkouts.get(threadId);
    if (!fresh && cached && Date.now() - cached.at < CHECKOUT_TTL_MS) return cached.value;
    const thread = await bb.sdk.threads.get({ threadId });
    let value: Checkout | null = null;
    if (thread.environmentId) {
      const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
      if (environment.path) {
        value = {
          environmentId: environment.id,
          hostId: environment.hostId,
          path: environment.path,
          local: await localHost(environment.hostId),
          hasLauncher: (await readText(environment.hostId, `${environment.path}/${LAUNCHER}`)) !== null,
        };
      }
    }
    checkouts.set(threadId, { at: Date.now(), value });
    if (value) {
      const threads = watchers.get(value.environmentId) ?? new Set();
      threads.add(threadId);
      watchers.set(value.environmentId, threads);
    }
    return value;
  }

  async function terminalSnapshot(terminalId: string): Promise<TerminalSnapshot | null> {
    try {
      const terminal = await bb.sdk.terminals.get({ terminalId });
      // A tab the user closed is gone, whatever the process exited with.
      if (terminal.closeReason !== null && terminal.closeReason !== "process-exit") return null;
      return { status: terminal.status, exitCode: terminal.exitCode };
    } catch {
      return null;
    }
  }

  async function scanTerminal(terminalId: string): Promise<Scan> {
    const previous = scans.get(terminalId);
    const scan = previous ?? { nextSeq: 0, carry: "", ready: false, url: null };
    try {
      const output = await bb.sdk.terminals.output({
        terminalId,
        sinceSeq: scan.nextSeq,
        ...(previous ? {} : { tailBytes: FIRST_SCAN_BYTES }),
      });
      const text = output.chunks
        .map((chunk) => Buffer.from(chunk.dataBase64, "base64").toString("utf8"))
        .join("");
      if (text !== "") {
        const plain = scan.carry + stripAnsi(text);
        const found = scanOutput(plain);
        scan.ready ||= found.ready;
        scan.url = found.url ?? scan.url;
        scan.carry = plain.slice(-SCAN_CARRY_CHARS);
      }
      scan.nextSeq = output.nextSeq;
    } catch {
      // Keep what was seen; a later poll retries.
    }
    scans.set(terminalId, scan);
    return scan;
  }

  async function portOpen(port: number): Promise<boolean> {
    // Dev servers bind IPv4, IPv6, or both depending on how localhost resolves.
    const results = await Promise.all(["127.0.0.1", "::1"].map((host) => probe(host, port)));
    return results.some(Boolean);
  }

  async function currentRun(checkout: Checkout) {
    const record = await bb.storage.kv.get<RunRecord>(runKey(checkout.environmentId));
    const terminal = record ? await terminalSnapshot(record.terminalId) : null;
    return { record: terminal ? record : null, terminal };
  }

  async function statusFor(threadId: string): Promise<DevServerStatus> {
    const checkout = await checkoutFor(threadId);
    if (!checkout?.hasLauncher) {
      return {
        state: "unavailable",
        environmentId: checkout?.environmentId ?? null,
        url: null,
        terminalId: null,
        logPath: null,
        external: false,
        exitCode: null,
      };
    }
    const { record, terminal } = await currentRun(checkout);
    const savedText = await readText(checkout.hostId, `${checkout.path}/${SAVED_ENVIRONMENT}`);
    const saved = savedText === null ? null : parseSavedEnvironment(savedText, checkout.path);
    const scan = record ? await scanTerminal(record.terminalId) : null;
    const url = saved?.url ?? scan?.url ?? null;
    const port = saved?.sitePort ?? (url ? portFromUrl(url) : null);
    const ours = terminal?.status === "running" || terminal?.status === "starting";
    // Without the launcher's saved environment, a listener on an old URL's
    // port could be anything, so only our own run may use a scanned URL.
    const open =
      checkout.local && port !== null && (saved !== null || ours) ? await portOpen(port) : false;
    const { state, external } = deriveState({
      terminal,
      stopping: stopping.has(checkout.environmentId),
      readySeen: scan?.ready ?? false,
      portOpen: open,
    });
    const running = state === "starting" || state === "ready" || state === "stopping";
    // An old exited tab says nothing about a server started outside BB.
    const ownRun = record && !external ? record : null;
    if (state === "ready" && ownRun && url) void openWhenReady(checkout, ownRun, url);
    return {
      state,
      environmentId: checkout.environmentId,
      url: running ? url : null,
      terminalId: ownRun?.threadId === threadId ? ownRun.terminalId : null,
      logPath: saved?.logPath ?? null,
      external,
      exitCode: ownRun ? (terminal?.exitCode ?? null) : null,
    };
  }

  async function desktopWindow(hostId: string) {
    const browsers = bb.sdk.experimental_desktopBrowsers;
    // A remote checkout's app still opens in the desktop beside the server.
    const primary = await primaryHost();
    for (const candidate of new Set([hostId, ...(primary ? [primary] : [])])) {
      try {
        const { instances } = await browsers.listInstances({ hostId: candidate });
        if (instances[0]) return instances[0];
      } catch {
        // That host has no connected BB window.
      }
    }
    return null;
  }

  /**
   * Show the app in the thread's BB browser panel. Reuses a tab already on the
   * worktree's origin; `fresh` replaces it at the same address instead, so a
   * restarted server is not left on a stale error page.
   */
  async function openInBrowser(threadId: string, url: string, hostId: string, fresh: boolean) {
    const window = await desktopWindow(hostId);
    if (window === null) return false;
    const browsers = bb.sdk.experimental_desktopBrowsers;
    const scope = {
      hostId: window.hostId,
      instanceId: window.instanceId,
      generation: window.generation,
      threadId,
    };
    const origin = new URL(url).origin;
    const { tabs } = await browsers.listTabs(scope);
    const existing = tabs.filter((tab) => originOf(tab.url) === origin);
    if (existing[0] && !fresh) {
      await browsers.revealTab({ ...scope, tabId: existing[0].tabId });
      return true;
    }
    await browsers.createTab({ ...scope, url: existing[0]?.url ?? url, presentation: "reveal" });
    for (const tab of existing) {
      await browsers.closeTab({ ...scope, tabId: tab.tabId }).catch(() => undefined);
    }
    return true;
  }

  async function openWhenReady(checkout: Checkout, record: RunRecord, url: string) {
    if (record.browserOpened || autoOpening.has(record.terminalId)) return;
    autoOpening.add(record.terminalId);
    try {
      const key = runKey(checkout.environmentId);
      const current = await bb.storage.kv.get<RunRecord>(key);
      if (current?.terminalId !== record.terminalId || current.browserOpened) return;
      await bb.storage.kv.set(key, { ...current, browserOpened: true });
      if (!(await settings.get()).openBrowserWhenReady) return;
      await openInBrowser(record.threadId, url, checkout.hostId, true);
    } catch (error) {
      bb.log.warn(`opening ${url} in BB's browser failed: ${String(error)}`);
    } finally {
      autoOpening.delete(record.terminalId);
    }
  }

  async function waitForExit(terminalId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !lifetime.signal.aborted) {
      const terminal = await terminalSnapshot(terminalId);
      if (terminal === null || terminal.status === "exited") return true;
      await sleep(500, lifetime.signal);
    }
    return false;
  }

  async function closeTerminal(terminalId: string) {
    try {
      await bb.sdk.terminals.close({ terminalId, mode: "force" });
    } catch {
      // Already closed.
    }
    scans.delete(terminalId);
  }

  async function launch(threadId: string, checkout: Checkout): Promise<{ terminalId: string }> {
    const { record, terminal } = await currentRun(checkout);
    if (record && terminal && terminal.status !== "exited") {
      if (record.threadId === threadId) return { terminalId: record.terminalId };
      throw new Error("./dev.sh is already running for this checkout from another thread.");
    }
    const status = await statusFor(threadId);
    if (status.external) {
      throw new Error("./dev.sh is already running for this checkout outside BB. Stop it first.");
    }
    // Replace the previous run's exited tab instead of stacking them up.
    if (record) await closeTerminal(record.terminalId);
    const { extraArgs } = await settings.get();
    const args = extraArgsSchema.safeParse(extraArgs).success ? shellArgs(extraArgs) : [];
    const created = await bb.sdk.terminals.create({
      scope: { kind: "thread", threadId },
      cols: 120,
      rows: 32,
      title: LAUNCHER,
      start: { mode: "command", command: [`./${LAUNCHER}`, ...args].join(" ") },
    });
    await bb.storage.kv.set(runKey(checkout.environmentId), {
      terminalId: created.id,
      threadId,
      startedAt: Date.now(),
    } satisfies RunRecord);
    bb.log.info(`started ${LAUNCHER} in ${checkout.path} (${created.id})`);
    return { terminalId: created.id };
  }

  /** Begin stopping; resolves once the server is down or was force-closed. */
  async function beginStop(threadId: string, checkout: Checkout): Promise<Promise<void> | null> {
    const pending = stopping.get(checkout.environmentId);
    if (pending) return pending;
    const { record, terminal } = await currentRun(checkout);
    let finish: () => Promise<void>;
    if (record && terminal && terminal.status !== "exited") {
      // Ctrl-C lets the launcher run its own scoped cleanup.
      await bb.sdk.terminals.input({
        terminalId: record.terminalId,
        dataBase64: Buffer.from("\u0003").toString("base64"),
      });
      finish = async () => {
        if (!(await waitForExit(record.terminalId, STOP_GRACE_MS))) {
          bb.log.warn(`${LAUNCHER} did not exit after Ctrl-C; closing ${record.terminalId}`);
          await closeTerminal(record.terminalId);
        }
      };
    } else if ((await statusFor(threadId)).external) {
      if ((await readText(checkout.hostId, `${checkout.path}/${STOPPER}`)) === null) return null;
      const stopper = await bb.sdk.terminals.create({
        scope: { kind: "thread", threadId },
        cols: 120,
        rows: 16,
        title: STOPPER,
        start: { mode: "command", command: `./${STOPPER}` },
      });
      finish = async () => {
        await waitForExit(stopper.id, STOP_GRACE_MS);
        await closeTerminal(stopper.id);
      };
    } else {
      return null;
    }
    const done = finish()
      .catch((error: unknown) => bb.log.warn(`stopping ${LAUNCHER} failed: ${String(error)}`))
      .finally(() => {
        stopping.delete(checkout.environmentId);
        invalidateEnvironment(checkout.environmentId);
      });
    stopping.set(checkout.environmentId, done);
    invalidateEnvironment(checkout.environmentId);
    return done;
  }

  async function requireCheckout(threadId: string): Promise<Checkout> {
    const checkout = await checkoutFor(threadId, true);
    if (!checkout?.hasLauncher) throw new Error(`This thread's checkout has no ./${LAUNCHER}.`);
    return checkout;
  }

  async function serveStatus(threadId: string): Promise<DevServerStatus> {
    const status = await statusFor(threadId);
    lastServed.set(threadId, JSON.stringify(status));
    return status;
  }

  async function startRun(threadId: string) {
    const checkout = await requireCheckout(threadId);
    const result = await withLock(checkout.environmentId, () => launch(threadId, checkout));
    invalidateEnvironment(checkout.environmentId);
    return result;
  }

  async function stopRun(threadId: string) {
    const checkout = await requireCheckout(threadId);
    const pending = await withLock(checkout.environmentId, () => beginStop(threadId, checkout));
    return pending !== null;
  }

  bb.rpc.register(rpcContract, {
    status: async ({ keys }) => {
      const entries = await Promise.all(
        keys.map(async (threadId) => [threadId, await serveStatus(threadId)] as const),
      );
      return Object.fromEntries(entries);
    },
    start: ({ threadId }) => startRun(threadId),
    stop: async ({ threadId }) => ({ stopped: await stopRun(threadId) }),
    open: async ({ threadId }) => {
      const checkout = await requireCheckout(threadId);
      const status = await statusFor(threadId);
      if (status.url === null) throw new Error("The dev server has not reported a URL yet.");
      return { opened: await openInBrowser(threadId, status.url, checkout.hostId, false) };
    },
    restart: async ({ threadId }) => {
      const checkout = await requireCheckout(threadId);
      const result = await withLock(checkout.environmentId, async () => {
        await (await beginStop(threadId, checkout));
        return launch(threadId, checkout);
      });
      invalidateEnvironment(checkout.environmentId);
      return result;
    },
  });

  bb.cli.register(
    createDevServerCli({
      status: statusFor,
      runTerminal: async (threadId) => {
        const checkout = await checkoutFor(threadId);
        return checkout ? ((await currentRun(checkout)).record?.terminalId ?? null) : null;
      },
      start: async (threadId) => {
        await startRun(threadId);
      },
      stop: stopRun,
      sleep: (ms, signal) => sleep(ms, signal ?? lifetime.signal),
    }),
  );

  // Poll only threads whose header is on screen, and push a refresh on change.
  bb.rpc.experimental_whileWatched("status", async (read, signal) => {
    if (!("key" in read)) return;
    const parsed = threadIdSchema.safeParse(read.key);
    if (!parsed.success) return;
    const threadId = parsed.data;
    bb.log.debug(`watching status for ${threadId}`);
    while (!signal.aborted) {
      let delay = 4_000;
      try {
        const status = await statusFor(threadId);
        const serialized = JSON.stringify(status);
        const served = lastServed.get(threadId);
        if (served !== undefined && served !== serialized) {
          lastServed.set(threadId, serialized);
          bb.rpc.experimental_invalidate([`thread:${threadId}`]);
        }
        if (status.state === "starting" || status.state === "stopping") delay = 1_500;
        if (status.state === "unavailable") delay = CHECKOUT_TTL_MS;
      } catch (error) {
        bb.log.debug(`status poll for ${threadId} failed: ${String(error)}`);
        delay = 10_000;
      }
      await sleep(delay, signal);
    }
    lastServed.delete(threadId);
  });
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function portFromUrl(url: string): number | null {
  const { port } = new URL(url);
  return port === "" ? null : Number(port);
}

function probe(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(400, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
