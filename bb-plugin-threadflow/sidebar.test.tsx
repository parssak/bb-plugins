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
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
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
      slot.getByRole("link", { name: "child" }).closest("[data-threadflow-children]"),
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
    expect(row.closest("[data-threadflow-children]")).toBeTruthy();
    expect(slot.getAllByRole("link", { name: id })).toHaveLength(1);
  }
  expect(slot.queryByRole("link", { name: "worker" })).toBeNull();
  slot.lifecycle.unmount();
});

test("hidden reviews nest under their thread and keep it working while they run", async () => {
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
      sidebarThreads: { threads: [thread("parent")], projects: [] },
      sidebarPullRequests: {
        parent: {
          experimental_autoMerge: false,
          experimental_inMergeQueue: null,
          experimental_checks: { state: "passing" },
          experimental_review: { state: "none" },
          experimental_mergeability: { state: "mergeable" },
          number: 7,
          title: "Parent",
          url: "https://github.com/example/repo/pull/7",
          state: "open",
          attention: "none",
        },
      },
      rpc: {
        wait_dependencies: () => ({ dependencies: [], scheduledSends: [] }),
        hidden_child_threads: () => ({
          threads: [
            {
              id: "review",
              title: "Review",
              parentThreadId: "parent",
              createdAt: 2,
              status: "idle",
              needsAttention: false,
              backgroundWork: 2,
              queuedWork: "none",
              originKind: "fork",
              originPluginId: "chat-tools",
            },
            {
              id: "reply",
              title: "Reply",
              parentThreadId: "review",
              createdAt: 3,
              status: "active",
              needsAttention: false,
              backgroundWork: 0,
              queuedWork: "none",
              originKind: "fork",
              originPluginId: "side-chat",
            },
          ],
        }),
      },
    },
  );
  const review = await slot.findByRole("link", { name: "Review" });
  const reply = slot.getByRole("link", { name: "Reply" });
  const parentRow = slot.getByRole("link", { name: "parent" }).parentElement!
    .parentElement!;
  expect(parentRow.contains(review)).toBe(true);
  expect(review.closest("[data-threadflow-children]")?.contains(reply)).toBe(true);
  expect(review.closest("[data-threadflow-children]")).not.toBe(reply.closest("[data-threadflow-children]"));
  // BB's built-in side chats can be closed too, so an unused one isn't stuck.
  expect(slot.getByRole("button", { name: "Close Reply" })).toBeTruthy();
  expect(slot.getByRole("img", { name: "2 background agents running" }))
    .toBeTruthy();
  expect(slot.getAllByRole("img", { name: "Working" })).toHaveLength(2);
  expect(parentRow.closest("section")?.textContent).toMatch(/^working/);
  fireEvent.click(review);
  expect(slot.inspection.navigateCalls).toContainEqual(
    expect.objectContaining({ method: "toThread", threadId: "review" }),
  );
  slot.lifecycle.unmount();
});

test("a send-later on a hidden review snoozes its parent and shows the send time", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const sendAt = Date.now() + 2 * 60 * 60 * 1_000 + 60_000;
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
      sidebarThreads: { threads: [thread("parent")], projects: [] },
      rpc: {
        wait_dependencies: () => ({
          dependencies: [],
          scheduledSends: [{ threadId: "review", sendAt }],
        }),
        hidden_child_threads: () => ({
          threads: [
            {
              id: "review",
              title: "Review",
              parentThreadId: "parent",
              createdAt: 2,
              status: "idle",
              needsAttention: false,
              backgroundWork: 0,
              queuedWork: "waiting",
              originKind: "fork",
              originPluginId: "chat-tools",
            },
          ],
        }),
      },
    },
  );
  await slot.findByRole("link", { name: "Review" });
  const parent = slot.getByRole("link", { name: "parent" });
  await waitFor(() =>
    expect(parent.closest("section")?.textContent).toMatch(/^snoozed/),
  );
  expect(parent.textContent).toContain("in 2h");
  slot.lifecycle.unmount();
});

async function renderActiveList() {
  // jsdom doesn't implement scrolling.
  HTMLElement.prototype.scrollIntoView ??= () => {};
  const app = await loadPluginApp(() => import("./app"));
  return renderSlot(
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
}

test("Escape with nothing focused reaches BB first and is left alone when BB handles it", async () => {
  const slot = await renderActiveList();
  const row = await slot.findByRole("link", { name: "one" });
  const seen: boolean[] = [];
  const hostEscape = (event: KeyboardEvent) => {
    seen.push(true);
    event.preventDefault();
  };
  document.addEventListener("keydown", hostEscape);
  document.body.focus();
  fireEvent.keyDown(document.body, { key: "Escape" });
  document.removeEventListener("keydown", hostEscape);
  expect(seen).toEqual([true]);
  expect(document.activeElement).not.toBe(row);

  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(document.activeElement).toBe(row);
});

test("typing on a sidebar row with no composer to take it leaves the key alone", async () => {
  const slot = await renderActiveList();
  const row = await slot.findByRole("link", { name: "one" });
  row.focus();
  expect(fireEvent.keyDown(row, { key: "x" })).toBe(true);
  expect(fireEvent.keyDown(row, { key: " " })).toBe(true);
});
