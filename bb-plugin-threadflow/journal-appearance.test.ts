import assert from "node:assert/strict";
import test from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.ts";
import { DEFAULT_JOURNAL_APPEARANCE, JOURNAL_APPEARANCE_KEY } from "./journal-appearance.ts";

test("journal appearance persists through plugin reload and rejects unsafe values", async () => {
  let { bb, harness } = createFakePluginHost({ pluginId: "threadflow" });
  plugin(bb);
  try {
    assert.deepEqual(await harness.behavior.callRpc("journal_appearance", {}), DEFAULT_JOURNAL_APPEARANCE);
    const appearance = { ...DEFAULT_JOURNAL_APPEARANCE, letterSpacing: 0.4, topPadding: 80 };
    await harness.behavior.callRpc("save_journal_appearance", appearance);
    ({ harness } = await harness.lifecycle.reload(plugin));
    assert.deepEqual(await harness.behavior.callRpc("journal_appearance", {}), appearance);
    await assert.rejects(harness.behavior.callRpc("save_journal_appearance", { ...appearance, fontSize: 200 }));
    assert.deepEqual(await harness.behavior.callRpc("journal_appearance", {}), appearance);
  } finally { await harness.lifecycle.dispose(); }
});

test("invalid stored journal appearance falls back to defaults", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "threadflow" });
  await bb.storage.kv.set(JOURNAL_APPEARANCE_KEY, { fontSize: "invalid" });
  plugin(bb);
  try {
    assert.deepEqual(await harness.behavior.callRpc("journal_appearance", {}), DEFAULT_JOURNAL_APPEARANCE);
  } finally { await harness.lifecycle.dispose(); }
});
