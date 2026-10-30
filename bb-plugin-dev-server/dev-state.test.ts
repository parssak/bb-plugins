import assert from "node:assert/strict";
import test from "node:test";

import { deriveState, parseSavedEnvironment, scanOutput, shellArgs } from "./dev-state.ts";

const ROOT = "/work/usebogi.com";

test("reads the worktree URL, site port and log from .dev/environment.json", () => {
  const saved = parseSavedEnvironment(
    JSON.stringify({
      id: "1a2b3c4d5e6f",
      root: ROOT,
      ports: { site: 14005, backend: 14006 },
      url: "http://bogi-1a2b3c4d5e6f.localhost:14005",
      log: `${ROOT}/.dev/dev.log`,
    }),
    ROOT,
  );
  assert.deepEqual(saved, {
    url: "http://bogi-1a2b3c4d5e6f.localhost:14005",
    sitePort: 14005,
    logPath: ".dev/dev.log",
  });
});

test("ignores a saved environment copied from another checkout or without a URL", () => {
  const copied = JSON.stringify({ root: "/elsewhere", url: "http://bogi-x.localhost:14005" });
  assert.equal(parseSavedEnvironment(copied, ROOT), null);
  assert.equal(parseSavedEnvironment(JSON.stringify({ root: ROOT, url: "file:///etc" }), ROOT), null);
  assert.equal(parseSavedEnvironment("not json", ROOT), null);
});

test("detects the launcher banner only once every service is up", () => {
  const preparing = "\u001b[1mDevelopment URL: http://bogi-x.localhost:14005\u001b[0m\r\nsite:dev: ✓ Ready in 2.1s\r\n";
  assert.deepEqual(scanOutput(preparing), { ready: false, url: "http://bogi-x.localhost:14005" });
  const ready = `${preparing}[dev timing] all services ready: 41s since launch\n  Bogi is ready\n\n  Open: https://bogi-x.localhost:1355\n`;
  assert.deepEqual(scanOutput(ready), { ready: true, url: "https://bogi-x.localhost:1355" });
});

test("derives header state from the terminal, stop requests and the site port", () => {
  const running = { status: "running" as const, exitCode: null };
  const base = { terminal: running, stopping: false, readySeen: false, portOpen: false };
  assert.deepEqual(deriveState(base), { state: "starting", external: false });
  assert.deepEqual(deriveState({ ...base, readySeen: true }), { state: "ready", external: false });
  assert.deepEqual(deriveState({ ...base, stopping: true }), { state: "stopping", external: false });
  assert.deepEqual(deriveState({ ...base, terminal: null, portOpen: true }), {
    state: "ready",
    external: true,
  });
  assert.deepEqual(deriveState({ ...base, terminal: { status: "exited", exitCode: 1 } }), {
    state: "failed",
    external: false,
  });
  assert.deepEqual(deriveState({ ...base, terminal: { status: "exited", exitCode: 130 } }), {
    state: "stopped",
    external: false,
  });
});

test("splits extra launcher arguments on whitespace", () => {
  assert.deepEqual(shellArgs("  --portless   --refresh "), ["--portless", "--refresh"]);
  assert.deepEqual(shellArgs(""), []);
});
