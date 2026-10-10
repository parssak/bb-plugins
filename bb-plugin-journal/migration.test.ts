import assert from "node:assert/strict";
import test from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.ts";
import { ownsLegacyKey } from "./legacy-storage.ts";
test("migration copies notes and existing daily chats once and preserves destination edits", async () => {
  const entries = new Map<string, unknown>([
    ["journal:2026-10-09", "Existing note"],
    ["journal-chat:2026-10-09", "original-chat"],
  ]);
  const chat = makeThreadResponse({
    id: "original-chat",
    title: "Journal chat · 2026-10-09",
    visibility: "hidden",
    originPluginId: "threadflow",
  });
  let reads = 0;
  const { bb, harness } = createFakePluginHost({
    pluginId: "journal",
    sdk: {
      plugins: {
        callRpc: async ({ method, input }) => {
          reads++;
          return method === "migration_keys"
            ? { keys: [...entries.keys()] }
            : {
                found: true,
                value: entries.get((input as { key: string }).key),
              };
        },
      },
      threads: { get: async () => chat },
    },
  });
  plugin(bb);
  assert.deepEqual(
    await harness.behavior.callRpc("migrate_from_threadflow", {}),
    { copied: 2, alreadyComplete: false },
  );
  assert.deepEqual(
    await harness.behavior.callRpc("journal_entry", { dateKey: "2026-10-09" }),
    { content: "Existing note" },
  );
  assert.deepEqual(
    await harness.behavior.callRpc("journal_chat", { dateKey: "2026-10-09" }),
    { threadId: "original-chat" },
  );
  assert.equal(harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  await harness.behavior.callRpc("save_journal_entry", {
    dateKey: "2026-10-09",
    content: "New edit",
  });
  const count = reads;
  assert.deepEqual(
    await harness.behavior.callRpc("migrate_from_threadflow", {}),
    { copied: 0, alreadyComplete: true },
  );
  assert.equal(reads, count);
  assert.deepEqual(
    await harness.behavior.callRpc("journal_entry", { dateKey: "2026-10-09" }),
    { content: "New edit" },
  );
  await harness.lifecycle.dispose();
});
test("failed imports retry without overwriting notes that already copied", async () => {
  let fail = true;
  const { bb, harness } = createFakePluginHost({
    pluginId: "journal",
    sdk: {
      plugins: {
        callRpc: async ({ method, input }) => {
          if (method === "migration_keys")
            return { keys: ["journal:2026-10-08", "journal:2026-10-09"] };
          if ((input as { key: string }).key.endsWith("09") && fail)
            throw new Error("Disconnected");
          return { found: true, value: "Legacy note" };
        },
      },
    },
  });
  plugin(bb);
  await assert.rejects(harness.behavior.callRpc("migrate_from_threadflow", {}));
  await harness.behavior.callRpc("save_journal_entry", {
    dateKey: "2026-10-08",
    content: "Edited after failure",
  });
  fail = false;
  assert.deepEqual(
    await harness.behavior.callRpc("migrate_from_threadflow", {}),
    { copied: 1, alreadyComplete: false },
  );
  assert.equal(
    await bb.storage.kv.get("journal:2026-10-08"),
    "Edited after failure",
  );
  await harness.lifecycle.dispose();
});
test("legacy exports cannot select settings, secrets, or unrelated plugin state", () => {
  assert.equal(ownsLegacyKey("journal", "githubToken"), false);
  assert.equal(ownsLegacyKey("journal", "workout:scratchpad:v1"), false);
  assert.equal(ownsLegacyKey("journal", "journal:2026-10-09"), true);
});
