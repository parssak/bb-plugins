// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { mountSidebarLayout } from "./sidebar-layout";

test("layout follows chat width and stays docked across sidebar toggles", () => {
  let onResize = () => {};
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { onResize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
  const shell = document.createElement("div");
  shell.innerHTML = '<div data-sidebar="gap"></div><main data-sidebar="inset"><div data-thread-window></div></main>';
  document.body.append(shell);
  const [gap, inset, chat] = [shell.children[0]!, shell.children[1]!, shell.querySelector('[data-thread-window]')!];
  let widths = [0, 1400, 650];
  [gap, inset, chat].forEach((element, index) => {
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => ({ width: widths[index], height: 800, left: 0, top: 0 }) as DOMRect);
  });
  const controller = new AbortController();
  const floating = () => document.documentElement.hasAttribute("data-threadflow-sidebar-floating");
  const update = () => {
    // Real requestAnimationFrame is async; flush one scheduled resize per step.
    let callback: FrameRequestCallback | undefined;
    vi.mocked(window.requestAnimationFrame).mockImplementation((next) => { callback = next; return 1; });
    onResize();
    callback?.(0);
  };
  try {
    mountSidebarLayout({ signal: controller.signal });
    expect(floating()).toBe(false); // Wide window, narrow chat beside a panel.
    widths = [250, 1150, 650 * 1150 / 1400];
    update();
    expect(floating()).toBe(false); // Docking doesn't change the decision.
    widths = [0, 1400, 1000];
    update();
    expect(floating()).toBe(true);
    controller.abort();
    expect(floating()).toBe(false);
  } finally {
    controller.abort();
    shell.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
