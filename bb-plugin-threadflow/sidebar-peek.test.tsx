// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { mountSidebarPeek } from "./sidebar-peek";

afterEach(() => { vi.useRealTimers(); });

test("releasing during a delayed drawer open still restores closed state", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const shell = document.createElement("div");
  shell.innerHTML = '<div data-sidebar="panel" data-vaul-drawer-direction="left" data-state="closed"></div><button data-sidebar="trigger"></button>';
  document.body.append(shell);
  const panel = shell.firstElementChild as HTMLElement;
  (shell.lastElementChild as HTMLButtonElement).onclick = () => {
    setTimeout(() => { panel.dataset.state = panel.dataset.state === "open" ? "closed" : "open"; }, 180);
  };
  mountSidebarPeek({ signal: controller.signal });
  try {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true }));
    await vi.advanceTimersByTimeAsync(200);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" }));
    await vi.advanceTimersByTimeAsync(400);
    expect(panel.dataset.state).toBe("closed");
    expect(document.documentElement.hasAttribute("data-threadflow-sidebar-floating")).toBe(false);
  } finally {
    controller.abort();
    shell.remove();
  }
});

test.each([false, true])("holding Command restores only its temporary sidebar (compact=%s)", async (compact) => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const shell = document.createElement("div");
  const panel = document.createElement("div");
  panel.dataset.sidebar = "panel";
  if (compact) panel.dataset.vaulDrawerDirection = "left";
  let open = false;
  const setOpen = (value: boolean) => {
    open = value;
    shell.dataset.state = open ? "expanded" : "collapsed";
    panel.dataset.state = open ? "open" : "closed";
  };
  setOpen(false);
  const trigger = document.createElement("button");
  trigger.dataset.sidebar = "trigger";
  trigger.onclick = () => setOpen(!open);
  shell.append(panel, trigger);
  document.body.append(shell);
  mountSidebarPeek({ signal: controller.signal });
  const key = (type: string, value: string, metaKey = true) => {
    const event = new KeyboardEvent(type, { key: value, metaKey, cancelable: true });
    window.dispatchEvent(event);
    return event;
  };
  const hold = () => { key("keydown", "Meta"); vi.advanceTimersByTime(200); };
  const release = () => key("keyup", "Meta", false);
  try {
    key("keydown", "Meta");
    key("keydown", "c");
    vi.advanceTimersByTime(200);
    expect(open).toBe(false); // Ordinary shortcuts don't flash the sidebar.
    release();
    hold();
    expect(open).toBe(true);
    expect(document.documentElement.hasAttribute("data-threadflow-sidebar-floating")).toBe(true);
    key("keydown", "1");
    setOpen(false); // Thread navigation may close the host sidebar.
    await Promise.resolve();
    expect(open).toBe(true); // Keep it visible while Command remains held.
    key("keyup", "1");
    expect(open).toBe(true);
    release();
    expect(open).toBe(false);
    expect(document.documentElement.hasAttribute("data-threadflow-sidebar-floating")).toBe(false);
    setOpen(true);
    hold(); release();
    expect(open).toBe(true); // A previously open sidebar stays open.
    setOpen(false);
    hold();
    expect(key("keydown", "b").defaultPrevented).toBe(true);
    release();
    expect(open).toBe(true); // Cmd+B pins a peek open.
    setOpen(false);
    hold();
    window.dispatchEvent(new Event("blur"));
    expect(open).toBe(false);
    hold();
    controller.abort();
    expect(open).toBe(false);
    expect(document.documentElement.hasAttribute("data-threadflow-sidebar-floating")).toBe(false);
    hold();
    expect(open).toBe(false);
  } finally {
    controller.abort();
    shell.remove();
  }
});
