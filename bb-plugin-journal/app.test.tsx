// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
afterEach(cleanup);
test("Journal owns its rail page and host chat tab independently of Threadflow", async () => {
  const app = await loadPluginApp(() => import("./app"));
  expect(app.threadLists).toHaveLength(0);
  const panel = app.navPanels[0]!;
  expect(panel.title).toBe("Journal");
  expect(panel.fixedTabs?.[0]?.title).toBe("Chat");
  const slot = renderSlot(
    panel,
    { subPath: "2026-10-09" },
    {
      pluginId: "journal",
      rpc: {
        journal_entry: () => ({ content: "Existing daily note" }),
        journal_thread_statuses: () => ({ statuses: [] }),
        save_journal_entry: () => ({ ok: true }),
      },
    },
  );
  await waitFor(() =>
    expect(
      slot.getByRole("textbox", { name: /Journal for/ }).textContent,
    ).toContain("Existing daily note"),
  );
  slot.lifecycle.unmount();
});
