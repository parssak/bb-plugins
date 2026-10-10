// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
afterEach(cleanup);
function thread(
  id: string,
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    title: id,
    displayTitle: id,
    projectId: "personal",
    parentThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: { backgroundCommands: 0 },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/threads/${id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: null,
    latestAttentionAt: 1,
    ...overrides,
  } as PluginSidebarThread;
}
test("Threadflow reads host rows and navigates without Journal, Usage, or Chat tools", async () => {
  const app = await loadPluginApp(() => import("./app"));
  expect(app.navPanels).toHaveLength(0);
  expect(app.threadPanelActions).toHaveLength(0);
  const slot = renderSlot(
    app.threadLists[0]!,
    {
      activeThreadId: "one",
      activeProjectId: null,
      isCompactViewport: false,
      onNavigate: () => {},
      searchQuery: "",
    },
    {
      sidebarThreads: { threads: [thread("one")], projects: [] },
      rpc: {
        wait_dependencies: () => ({ dependencies: [], scheduledSends: [] }),
        toggle_archived: () => ({ archived: true }),
      },
    },
  );
  const row = await slot.findByRole("link", { name: "one" });
  expect(row).toBeInstanceOf(HTMLAnchorElement);
  expect(row.getAttribute("data-sidebar-thread-shortcut-target")).toBe("");
  fireEvent.click(row);
  expect(slot.inspection.navigateCalls).toContainEqual(
    expect.objectContaining({ method: "toThread", threadId: "one" }),
  );
  expect(slot.inspection.rpcCalls.some((c) => c.method === "threads")).toBe(
    false,
  );
  fireEvent.click(slot.getByRole("button", { name: "Archive one" }));
  await waitFor(() =>
    expect(slot.inspection.rpcCalls).toContainEqual(
      expect.objectContaining({
        method: "toggle_archived",
        input: { id: "one" },
      }),
    ),
  );
  slot.lifecycle.unmount();
});
test("declared wait dependencies nest beneath their parent using host state", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(
    app.threadLists[0]!,
    {
      activeThreadId: null,
      activeProjectId: null,
      isCompactViewport: false,
      onNavigate: () => {},
      searchQuery: "",
    },
    {
      sidebarThreads: {
        threads: [
          thread("parent", { queuedWork: "waiting" }),
          thread("child", { status: "active", runtimeStatus: "active" }),
        ],
        projects: [],
      },
      rpc: {
        wait_dependencies: () => ({
          dependencies: [
            { waitingThreadId: "parent", targetThreadIds: ["child"] },
          ],
          scheduledSends: [],
        }),
      },
    },
  );
  await waitFor(() =>
    expect(
      slot.getByRole("link", { name: "child" }).closest(".border-l"),
    ).toBeTruthy(),
  );
  expect(slot.getAllByRole("link", { name: "child" })).toHaveLength(1);
  slot.lifecycle.unmount();
});
test("sidebar leaves dialogs and unrelated controls in charge of keyboard input", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(
    app.threadLists[0]!,
    {
      activeThreadId: "one",
      activeProjectId: null,
      isCompactViewport: false,
      onNavigate: () => {},
      searchQuery: "",
    },
    {
      sidebarThreads: { threads: [thread("one")], projects: [] },
      rpc: {
        wait_dependencies: () => ({ dependencies: [], scheduledSends: [] }),
      },
    },
  );
  await slot.findByRole("link", { name: "one" });
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  const input = document.createElement("input");
  dialog.append(input);
  document.body.append(dialog);
  input.focus();
  const event = new KeyboardEvent("keydown", {
    key: "x",
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  dialog.remove();
  slot.lifecycle.unmount();
});

test("canonical child threads nest once and hidden worker roots stay out of the list", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(
    app.threadLists[0]!,
    {
      activeThreadId: null,
      activeProjectId: null,
      isCompactViewport: false,
      onNavigate: () => {},
      searchQuery: "",
    },
    {
      sidebarThreads: {
        threads: [
          thread("parent"),
          thread("child", { parentThreadId: "parent" }),
          thread("legacy-review", {
            parentThreadId: "parent",
            isHidden: true,
            originKind: "fork",
            originPluginId: "threadflow",
          }),
          thread("worker", { isHidden: true }),
        ],
        projects: [],
      },
      rpc: {
        wait_dependencies: () => ({ dependencies: [], scheduledSends: [] }),
      },
    },
  );
  for (const id of ["child", "legacy-review"]) {
    const row = await slot.findByRole("link", { name: id });
    expect(row.closest(".border-l")).toBeTruthy();
    expect(slot.getAllByRole("link", { name: id })).toHaveLength(1);
  }
  expect(slot.queryByRole("link", { name: "worker" })).toBeNull();
  slot.lifecycle.unmount();
});
