// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { ArchiveShortcut, ArchiveThreadButton } from "./archive-controls";
afterEach(cleanup);

test("archive works from the composer with the sidebar unmounted", async () => {
  await loadPluginApp(() => import("./app"));
  const slot = renderSlot(
    { component: ArchiveShortcut },
    { activeThreadId: "active" },
    {
      rpc: { toggle_archived: () => ({ archived: true }) },
    },
  );
  const composer = document.createElement("textarea");
  document.body.append(composer);
  composer.focus();
  fireEvent.keyDown(composer, { key: "A", metaKey: true, shiftKey: true });
  await waitFor(() =>
    expect(slot.inspection.rpcCalls).toContainEqual(
      expect.objectContaining({
        method: "toggle_archived",
        input: { id: "active" },
      }),
    ),
  );
  composer.remove();
  slot.lifecycle.unmount();
});

test("archive targets the focused split or sidebar row and ignores key repeat", async () => {
  await loadPluginApp(() => import("./app"));
  const slot = renderSlot(
    { component: ArchiveShortcut },
    { activeThreadId: "main" },
    {
      sidebarSplitLayout: {
        panes: [
          {
            paneId: "side",
            threadId: "split",
            isFocused: true,
            rect: { x: 0, y: 0, width: 1, height: 1 },
          },
        ],
      },
      rpc: { toggle_archived: () => ({ archived: true }) },
    },
  );
  fireEvent.keyDown(document.body, { key: "a", metaKey: true, shiftKey: true });
  fireEvent.keyDown(document.body, {
    key: "a",
    metaKey: true,
    shiftKey: true,
    repeat: true,
  });
  await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(1));
  expect(slot.inspection.rpcCalls[0]?.input).toEqual({ id: "split" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const row = document.createElement("a");
  row.dataset.threadflowRow = "";
  row.dataset.threadId = "selected";
  document.body.append(row);
  fireEvent.keyDown(row, { key: "a", metaKey: true, shiftKey: true });
  await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(2));
  expect(slot.inspection.rpcCalls[1]?.input).toEqual({ id: "selected" });
  row.remove();
  slot.lifecycle.unmount();
});

test("archive leaves dialogs and menus in control and unregisters on unload", async () => {
  await loadPluginApp(() => import("./app"));
  const slot = renderSlot(
    { component: ArchiveShortcut },
    { activeThreadId: "active" },
    {
      rpc: { toggle_archived: () => ({ archived: true }) },
    },
  );
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  fireEvent.keyDown(dialog, { key: "a", metaKey: true, shiftKey: true });
  expect(slot.inspection.rpcCalls).toHaveLength(0);
  dialog.remove();
  slot.lifecycle.unmount();
  fireEvent.keyDown(document.body, { key: "a", metaKey: true, shiftKey: true });
  expect(slot.inspection.rpcCalls).toHaveLength(0);
});

test("the row archive button archives its own thread", async () => {
  await loadPluginApp(() => import("./app"));
  const slot = renderSlot(
    { component: ArchiveThreadButton },
    { threadId: "row", title: "My thread" },
    {
      rpc: { toggle_archived: () => ({ archived: true }) },
    },
  );
  fireEvent.click(slot.getByRole("button", { name: "Archive My thread" }));
  await waitFor(() =>
    expect(slot.inspection.rpcCalls[0]?.input).toEqual({ id: "row" }),
  );
  slot.lifecycle.unmount();
});
