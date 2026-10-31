// `bb dev-server`: the same runs as the header button, for agents and shells.
import { cliCommand, defineCli, PluginCliError, type PluginCliContext } from "@get-bb/plugin-sdk";
import { threadIdSchema, type DevServerStatus } from "./contract.ts";

export interface DevServerCliOperations {
  status(threadId: string): Promise<DevServerStatus>;
  /** The run's terminal, whichever thread started it. */
  runTerminal(threadId: string): Promise<string | null>;
  start(threadId: string): Promise<void>;
  stop(threadId: string): Promise<boolean>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

const POLL_MS = 1_500;

const threadOption = {
  type: "string",
  description: "Thread whose checkout to use; defaults to the calling thread.",
  placeholder: "thread-id",
} as const;
const jsonOption = { type: "boolean", description: "Print machine-readable JSON." } as const;

export function createDevServerCli(ops: DevServerCliOperations) {
  async function describe(threadId: string, status: DevServerStatus) {
    const terminalId = status.external ? null : await ops.runTerminal(threadId);
    const lines = [`state: ${status.state}${status.external ? " (started outside BB)" : ""}`];
    if (status.url) lines.push(`url: ${status.url}`);
    if (status.state === "failed" && status.exitCode !== null) lines.push(`exit code: ${status.exitCode}`);
    const logs = terminalId
      ? `bb terminal output ${terminalId} --tail-bytes 20000`
      : status.logPath
        ? status.logPath
        : null;
    if (logs) lines.push(`logs: ${logs}`);
    return { json: { ...status, runTerminalId: terminalId }, text: lines.join("\n"), logs };
  }

  async function reply(threadId: string, status: DevServerStatus, json: boolean) {
    const described = await describe(threadId, status);
    return {
      exitCode: 0,
      stdout: json ? JSON.stringify(described.json) : described.text,
    };
  }

  async function available(threadId: string): Promise<DevServerStatus> {
    const status = await ops.status(threadId);
    if (status.state === "unavailable") {
      throw new PluginCliError("This thread's checkout has no ./dev.sh.", { code: "no_launcher" });
    }
    return status;
  }

  async function waitForReady(threadId: string, timeoutMs: number, signal?: AbortSignal) {
    const deadline = Date.now() + timeoutMs;
    const stillStarting = () =>
      new PluginCliError("./dev.sh is still starting.", {
        code: "timeout",
        hint: "Run `bb dev-server start --wait` again to keep waiting; it does not start a second server.",
      });
    for (;;) {
      // A stalled read must not hold the command past its deadline.
      const status = await beforeDeadline(ops.status(threadId), deadline);
      if (status === null) throw stillStarting();
      if (status.state === "ready") return status;
      if (status.state !== "starting") {
        const { logs } = await describe(threadId, status);
        throw new PluginCliError(
          status.exitCode !== null && status.state === "failed"
            ? `./dev.sh exited with code ${status.exitCode} before it was ready.`
            : `./dev.sh is ${status.state}, not starting.`,
          { code: "dev_server_failed", ...(logs ? { hint: `Read the logs: ${logs}` } : {}) },
        );
      }
      if (Date.now() >= deadline || signal?.aborted) throw stillStarting();
      await ops.sleep(POLL_MS, signal);
    }
  }

  return defineCli({
    name: "dev-server",
    summary: "Run this checkout's ./dev.sh and get its worktree URL",
    description:
      "Each checkout runs at most one server, shared by every thread on it. The URL is that worktree's own isolated address.",
    commands: {
      status: cliCommand({
        summary: "Show the dev server's state, URL, and where its logs are",
        options: { thread: threadOption, json: jsonOption },
        run: async ({ options }, ctx) => {
          const threadId = threadFrom(options.thread, ctx);
          return reply(threadId, await available(threadId), options.json);
        },
      }),
      start: cliCommand({
        summary: "Start ./dev.sh unless it is already running; --wait blocks until it is ready",
        options: {
          thread: threadOption,
          wait: { type: "boolean", description: "Wait until every service is ready, then print the URL." },
          timeout: {
            type: "duration",
            description: "How long --wait waits (10s-15m). A first run that copies the database can take minutes.",
            defaultUnit: "m",
            min: 10_000,
            max: 15 * 60_000,
            default: 5 * 60_000,
          },
          json: jsonOption,
        },
        run: async ({ options }, ctx) => {
          const threadId = threadFrom(options.thread, ctx);
          let status = await available(threadId);
          if (status.state === "stopping") {
            throw new PluginCliError("./dev.sh is stopping.", {
              code: "stopping",
              hint: "Wait a few seconds, then start it again.",
            });
          }
          if (status.state === "stopped" || status.state === "failed") {
            await ops.start(threadId);
            status = await ops.status(threadId);
          }
          if (options.wait) status = await waitForReady(threadId, options.timeout, ctx.signal);
          return reply(threadId, status, options.json);
        },
      }),
      url: cliCommand({
        summary: "Print the URL once the dev server is ready; fails otherwise",
        options: { thread: threadOption },
        run: async ({ options }, ctx) => {
          const threadId = threadFrom(options.thread, ctx);
          const status = await available(threadId);
          if (status.state !== "ready" || status.url === null) {
            throw new PluginCliError(`The dev server is ${status.state}, not ready.`, {
              code: "not_ready",
              hint: "Run `bb dev-server start --wait`; it prints the URL when ready.",
            });
          }
          return { exitCode: 0, stdout: status.url };
        },
      }),
      stop: cliCommand({
        summary: "Stop the checkout's dev server with its own cleanup",
        options: { thread: threadOption },
        run: async ({ options }, ctx) => {
          const threadId = threadFrom(options.thread, ctx);
          await available(threadId);
          const stopped = await ops.stop(threadId);
          return { exitCode: 0, stdout: stopped ? "Stopping ./dev.sh." : "Nothing is running." };
        },
      }),
    },
  });
}

async function beforeDeadline<T>(work: Promise<T>, deadline: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

function threadFrom(option: string | undefined, ctx: PluginCliContext): string {
  const threadId = option ?? ctx.threadId;
  if (!threadId) {
    throw new PluginCliError("No thread to act on.", {
      code: "missing_thread",
      hint: "Run this inside a BB thread or pass --thread <thread-id>.",
    });
  }
  if (!threadIdSchema.safeParse(threadId).success) {
    throw new PluginCliError(`Not a BB thread ID: ${threadId}`, { code: "invalid_value" });
  }
  return threadId;
}
