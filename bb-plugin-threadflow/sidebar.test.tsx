// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { fireEvent, waitFor, cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

afterEach(cleanup);

test("compact navigation omits host destinations without a private DOM portal target", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const activations: string[] = [];
  const items = [
    { id: "new", label: "New thread", action: { kind: "new-thread" }, icon: { kind: "host", name: "new-thread" } },
    { id: "search", label: "Search threads", action: { kind: "search-threads" }, icon: { kind: "host", name: "search" } },
    { id: "journal", label: "Journal", action: { kind: "open-plugin-panel", pluginId: "threadflow", panelId: "journal" }, icon: { kind: "plugin", pluginId: "threadflow", icon: null } },
  ].map((item) => ({ ...item, isDisabled: false, shortcut: null, experimental_splitProps: {} }));
  const slot = renderSlot(app.experimentalSidebarNavigations[0]!, {
    items, activeItemId: null, isCompactViewport: false,
    experimental_activate: (id: string) => activations.push(id),
    experimental_Original: () => <div>Native navigation</div>,
  }, { rpc: { threads: () => ({ threads: [], generatedAt: 1 }) } });
  fireEvent.click(slot.getByRole("button", { name: "New thread" }));
  expect(slot.queryByRole("button", { name: "Search threads" })).toBeNull();
  expect(slot.getByRole("button", { name: "Show archived threads" })).toBeTruthy();
  fireEvent.click(slot.getByRole("button", { name: "Open Journal" }));
  expect(activations).toEqual(["new", "journal"]);
  slot.lifecycle.unmount();
});

test("sidebar leaves unrelated controls and dialogs in charge of keyboard input", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.threadLists[0]!, {
    activeThreadId: "thread-one", activeProjectId: null, isCompactViewport: false,
    onNavigate: () => {}, searchQuery: "", Original: () => null,
  }, { rpc: {
    threads: () => ({ threads: [{ id: "thread-one", title: "Example thread", projectId: "personal", project: "Personal", provider: "codex", createdAt: 1, updatedAt: 1, archivedAt: null, archived: false, needsAttention: false, queuedWork: "none", scheduledSendAt: null, waitingForThreadIds: [], status: "idle", sideChats: [] }], generatedAt: 1 }),
    codex_usage: () => ({ status: "unavailable", message: "Unavailable" }),
  } });
  const row = await waitFor(() => slot.getByRole("link", { name: "Example thread" }));
  // BB's native numbered shortcuts only collect HTMLAnchorElement targets.
  expect(row).toBeInstanceOf(HTMLAnchorElement);
  expect(row.getAttribute("data-sidebar-thread-shortcut-target")).toBe("");
  expect(row.getAttribute("data-sidebar-thread-id")).toBe("thread-one");
  expect(row.getAttribute("href")).toBe("/threads/thread-one");
  fireEvent.click(row);
  expect(slot.inspection.sidebarActionCalls).toContainEqual(expect.objectContaining({ method: "open", threadId: "thread-one" }));
  const button = document.createElement("button");
  document.body.append(button);
  button.focus();
  const key = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
  button.dispatchEvent(key);
  expect(key.defaultPrevented).toBe(false);
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.append(button);
  document.body.append(dialog);
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  button.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(false);
  dialog.remove();
  slot.lifecycle.unmount();
});
