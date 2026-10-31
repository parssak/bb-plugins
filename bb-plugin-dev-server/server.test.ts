import assert from "node:assert/strict";
import test from "node:test";

import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";

import plugin from "./server.ts";

const ROOT = "/work/usebogi.com";
const URL = "http://bogi-1a2b3c4d5e6f.localhost:14005";

interface FakeTerminal {
  status: "running" | "exited";
  exitCode: number | null;
  closeReason: "process-exit" | "user" | null;
  output: string;
  inputs: string[];
}

interface FakeBrowserTab {
  tabId: string;
  threadId: string;
  url: string;
}

function fakeCheckout(
  options: {
    launcher?: boolean;
    windows?: boolean;
    settings?: Record<string, string | number | boolean>;
    /** Shapes each new launcher terminal, e.g. to make it ready at once. */
    onCreate?: (terminal: FakeTerminal) => void;
  } = {},
) {
  const files = new Map<string, string>([
    [`${ROOT}/.dev/environment.json`, JSON.stringify({ root: ROOT, url: URL, ports: { site: 14005 }, log: `${ROOT}/.dev/dev.log` })],
  ]);
  if (options.launcher !== false) files.set(`${ROOT}/dev.sh`, "#!/bin/bash\n");
  const terminals = new Map<string, FakeTerminal>();
  const created: unknown[] = [];
  const closed: string[] = [];
  // BB's desktop window runs beside the server, not on the checkout's host.
  const window = { instanceId: "win_1", generation: "gen_1", label: "BB window 1", hostId: "host_server" };
  const browserTabs: FakeBrowserTab[] = [];
  const browserCalls: Array<{ method: string; input: Record<string, unknown> }> = [];
  const session = (id: string) => {
    const terminal = terminals.get(id);
    if (!terminal) throw new Error(`No terminal ${id}`);
    return { id, status: terminal.status, exitCode: terminal.exitCode, closeReason: terminal.closeReason };
  };
  const { bb, harness } = createFakePluginHost({
    pluginId: "dev-server-test",
    settings: options.settings,
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) =>
          makeThreadResponse({ id: threadId, environmentId: "env_shared" }),
      },
      environments: {
        get: async () => ({ id: "env_shared", hostId: "host_remote", path: ROOT }),
      },
      // A remote host: status comes from the terminal, never a local port probe.
      system: { config: async () => ({ primaryHostId: "host_server" }) },
      files: {
        read: async ({ path }: { path: string }) => {
          const content = files.get(path);
          if (content === undefined) throw new Error(`ENOENT ${path}`);
          return { content, contentEncoding: "utf8" };
        },
      },
      experimental_desktopBrowsers: {
        listInstances: async ({ hostId }: { hostId: string }) => ({
          instances: options.windows !== false && hostId === window.hostId ? [window] : [],
        }),
        listTabs: async ({ threadId }: { threadId: string }) => ({
          tabs: browserTabs
            .filter((tab) => tab.threadId === threadId)
            .map((tab) => ({ ...tab, title: "", control: null, presentation: "reveal" })),
        }),
        createTab: async (input: { threadId: string; url: string }) => {
          browserCalls.push({ method: "createTab", input });
          const tab = { tabId: `tab_${browserTabs.length + 1}`, threadId: input.threadId, url: input.url };
          browserTabs.push(tab);
          return { tab: { ...tab, title: "", control: null, presentation: "reveal" } };
        },
        revealTab: async (input: { tabId: string }) => {
          browserCalls.push({ method: "revealTab", input });
          return { ok: true };
        },
        closeTab: async (input: { tabId: string }) => {
          browserCalls.push({ method: "closeTab", input });
          browserTabs.splice(browserTabs.findIndex((tab) => tab.tabId === input.tabId), 1);
          return { ok: true };
        },
      },
      terminals: {
        create: async (args: unknown) => {
          created.push(args);
          const id = `term_${created.length}`;
          const terminal: FakeTerminal = { status: "running", exitCode: null, closeReason: null, output: "", inputs: [] };
          options.onCreate?.(terminal);
          terminals.set(id, terminal);
          return session(id);
        },
        get: async ({ terminalId }: { terminalId: string }) => session(terminalId),
        output: async ({ terminalId, sinceSeq = 0 }: { terminalId: string; sinceSeq?: number }) => {
          const terminal = terminals.get(terminalId)!;
          const text = terminal.output.slice(sinceSeq);
          return {
            chunks: text ? [{ seq: sinceSeq, dataBase64: Buffer.from(text).toString("base64") }] : [],
            nextSeq: terminal.output.length,
            status: terminal.status,
            exitCode: terminal.exitCode,
            closeReason: terminal.closeReason,
            truncated: false,
          };
        },
        input: async ({ terminalId, dataBase64 }: { terminalId: string; dataBase64: string }) => {
          const terminal = terminals.get(terminalId)!;
          terminal.inputs.push(Buffer.from(dataBase64, "base64").toString());
          // The launcher handles Ctrl-C by cleaning up and exiting 130.
          Object.assign(terminal, { status: "exited", exitCode: 130, closeReason: "process-exit" });
          return session(terminalId);
        },
        close: async ({ terminalId }: { terminalId: string }) => {
          closed.push(terminalId);
          Object.assign(terminals.get(terminalId)!, { status: "exited", closeReason: "user" });
          return session(terminalId);
        },
      },
    } as never,
  });
  return { bb, harness, terminals, created, closed, browserTabs, browserCalls };
}

async function statusOf(harness: ReturnType<typeof fakeCheckout>["harness"], threadId: string) {
  const statuses = (await harness.behavior.callRpc("status", { keys: [threadId] })) as Record<string, any>;
  return statuses[threadId];
}

test("threads without ./dev.sh get no header controls", async () => {
  const { bb, harness } = fakeCheckout({ launcher: false });
  await plugin(bb);
  assert.equal((await statusOf(harness, "thr_a")).state, "unavailable");
  await harness.lifecycle.dispose();
});

test("Run dev starts a thread terminal and reports ready once the banner prints", async () => {
  const { bb, harness, terminals, created } = fakeCheckout({ settings: { extraArgs: "--portless" } });
  await plugin(bb);
  assert.equal((await statusOf(harness, "thr_a")).state, "stopped");

  const { terminalId } = (await harness.behavior.callRpc("start", { threadId: "thr_a" })) as {
    terminalId: string;
  };
  assert.deepEqual(created, [{
    scope: { kind: "thread", threadId: "thr_a" },
    cols: 120,
    rows: 32,
    title: "dev.sh",
    start: { mode: "command", command: "./dev.sh --portless" },
  }]);
  assert.deepEqual(await statusOf(harness, "thr_a"), {
    state: "starting",
    environmentId: "env_shared",
    url: URL,
    terminalId,
    logPath: ".dev/dev.log",
    external: false,
    exitCode: null,
  });

  terminals.get(terminalId)!.output += "\u001b[1;36m  Bogi is ready\n\n  Open: " + URL + "\n";
  assert.equal((await statusOf(harness, "thr_a")).state, "ready");

  // Another thread on the same checkout sees the server but not the terminal.
  const sibling = await statusOf(harness, "thr_b");
  assert.equal(sibling.state, "ready");
  assert.equal(sibling.terminalId, null);
  await assert.rejects(
    harness.behavior.callRpc("start", { threadId: "thr_b" }),
    /already running for this checkout from another thread/,
  );
  assert.deepEqual(await harness.behavior.callRpc("start", { threadId: "thr_a" }), { terminalId });
  assert.equal(created.length, 1);
  await harness.lifecycle.dispose();
});

async function startReady(fake: ReturnType<typeof fakeCheckout>, threadId = "thr_a") {
  const { terminalId } = (await fake.harness.behavior.callRpc("start", { threadId })) as {
    terminalId: string;
  };
  fake.terminals.get(terminalId)!.output += `  Bogi is ready\n\n  Open: ${URL}\n`;
  const status = await statusOf(fake.harness, threadId);
  // Auto-open runs in the background of the status read.
  await new Promise((resolve) => setTimeout(resolve, 10));
  return status;
}

test("a run started here opens once in the thread's BB browser when it becomes ready", async () => {
  const fake = fakeCheckout();
  await plugin(fake.bb);
  assert.equal((await startReady(fake)).state, "ready");
  assert.deepEqual(fake.browserCalls, [{
    method: "createTab",
    input: {
      hostId: "host_server",
      instanceId: "win_1",
      generation: "gen_1",
      threadId: "thr_a",
      url: URL,
      presentation: "reveal",
    },
  }]);

  await statusOf(fake.harness, "thr_a");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(fake.browserCalls.length, 1);

  // Open app reveals the existing tab instead of stacking another.
  assert.deepEqual(await fake.harness.behavior.callRpc("open", { threadId: "thr_a" }), { opened: true });
  assert.deepEqual(fake.browserCalls.map((call) => call.method), ["createTab", "revealTab"]);
  await fake.harness.lifecycle.dispose();
});

test("a restarted server replaces its stale tab at the same address", async () => {
  const fake = fakeCheckout();
  await plugin(fake.bb);
  await startReady(fake);
  fake.browserTabs[0]!.url = `${URL}/dashboard`;
  fake.browserCalls.length = 0;

  const { terminalId } = (await fake.harness.behavior.callRpc("restart", { threadId: "thr_a" })) as {
    terminalId: string;
  };
  fake.terminals.get(terminalId)!.output += "  Bogi is ready\n";
  await statusOf(fake.harness, "thr_a");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(fake.browserCalls.map((call) => [call.method, call.input.url ?? call.input.tabId]), [
    ["createTab", `${URL}/dashboard`],
    ["closeTab", "tab_1"],
  ]);
  await fake.harness.lifecycle.dispose();
});

test("auto-open can be turned off, and Open app falls back without a BB window", async () => {
  const fake = fakeCheckout({ windows: false, settings: { openBrowserWhenReady: false } });
  await plugin(fake.bb);
  await startReady(fake);
  assert.deepEqual(fake.browserCalls, []);
  assert.deepEqual(await fake.harness.behavior.callRpc("open", { threadId: "thr_a" }), { opened: false });
  await fake.harness.lifecycle.dispose();
});

test("Stop dev interrupts the launcher so it can clean up its own processes", async () => {
  const { bb, harness, terminals } = fakeCheckout();
  await plugin(bb);
  const { terminalId } = (await harness.behavior.callRpc("start", { threadId: "thr_a" })) as {
    terminalId: string;
  };
  assert.deepEqual(await harness.behavior.callRpc("stop", { threadId: "thr_a" }), { stopped: true });
  assert.deepEqual(terminals.get(terminalId)!.inputs, ["\u0003"]);

  let status = await statusOf(harness, "thr_a");
  for (let attempt = 0; status.state === "stopping" && attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    status = await statusOf(harness, "thr_a");
  }
  assert.equal(status.state, "stopped");
  assert.equal(status.url, null);
  await harness.lifecycle.dispose();
});

test("a failed run keeps its logs and is replaced by the next run", async () => {
  const { bb, harness, terminals, closed } = fakeCheckout();
  await plugin(bb);
  const first = (await harness.behavior.callRpc("start", { threadId: "thr_a" })) as { terminalId: string };
  Object.assign(terminals.get(first.terminalId)!, {
    status: "exited",
    exitCode: 1,
    closeReason: "process-exit",
  });
  const failed = await statusOf(harness, "thr_a");
  assert.equal(failed.state, "failed");
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.terminalId, first.terminalId);

  const second = (await harness.behavior.callRpc("start", { threadId: "thr_a" })) as { terminalId: string };
  assert.notEqual(second.terminalId, first.terminalId);
  assert.deepEqual(closed, [first.terminalId]);
  assert.equal((await statusOf(harness, "thr_a")).state, "starting");
  await harness.lifecycle.dispose();
});

test("rejects thread ids that are not BB thread ids", async () => {
  const { bb, harness } = fakeCheckout();
  await plugin(bb);
  await assert.rejects(harness.behavior.callRpc("start", { threadId: "../etc" }));
  await harness.lifecycle.dispose();
});

test("bb dev-server start --wait starts the calling thread's server and prints its URL", async () => {
  const fake = fakeCheckout({
    onCreate: (terminal) => {
      terminal.output = "  Bogi is ready\n";
    },
  });
  await plugin(fake.bb);
  const ctx = { threadId: "thr_a" };
  const started = await fake.harness.behavior.runCli(["start", "--wait"], ctx);
  assert.equal(started.exitCode, 0, started.stderr);
  assert.match(started.stdout ?? "", new RegExp(`^state: ready\nurl: ${URL}\nlogs: bb terminal output term_1`));
  assert.deepEqual(await fake.harness.behavior.runCli(["url"], ctx), { exitCode: 0, stdout: URL, stderr: "" });

  // Starting again reuses the running server.
  const again = await fake.harness.behavior.runCli(["start", "--json"], { threadId: "thr_b" });
  assert.equal(JSON.parse(again.stdout ?? "").runTerminalId, "term_1");
  assert.equal(fake.created.length, 1);
  await fake.harness.lifecycle.dispose();
});

test("bb dev-server explains a failed start and a server that is not ready", async () => {
  const fake = fakeCheckout({
    onCreate: (terminal) => {
      Object.assign(terminal, { status: "exited", exitCode: 1, closeReason: "process-exit" });
    },
  });
  await plugin(fake.bb);
  const notReady = await fake.harness.behavior.runCli(["url", "--thread", "thr_a"]);
  assert.equal(notReady.exitCode, 1);
  assert.match(notReady.stderr ?? "", /stopped, not ready/);

  const failed = await fake.harness.behavior.runCli(["start", "--wait", "--thread", "thr_a"]);
  assert.equal(failed.exitCode, 1);
  assert.match(failed.stderr ?? "", /exited with code 1 before it was ready/);
  assert.match(failed.stderr ?? "", /bb terminal output term_1/);

  const noThread = await fake.harness.behavior.runCli(["status"]);
  assert.equal(noThread.exitCode, 1);
  assert.match(noThread.stderr ?? "", /--thread/);
  await fake.harness.lifecycle.dispose();
});
