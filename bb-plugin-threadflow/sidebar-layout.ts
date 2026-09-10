const FLOATING_CHAT_MIN_WIDTH = 700;

export function mountSidebarLayout({ signal }: { signal: AbortSignal }) {
  const root = document.documentElement;
  let frame: number | undefined;
  let observed: Element[] = [];
  const update = () => {
    frame = undefined;
    const inset = document.querySelector<HTMLElement>('[data-sidebar="inset"]');
    const gap = document.querySelector<HTMLElement>('[data-sidebar="gap"]');
    const chats = Array.from(document.querySelectorAll<HTMLElement>('[data-sidebar="inset"] [data-thread-window]'));
    const next = [inset, gap, ...chats].filter((element): element is HTMLElement => element !== null);
    if (next.length !== observed.length || next.some((element, index) => element !== observed[index])) {
      resize.disconnect();
      next.forEach((element) => resize.observe(element));
      observed = next;
    }
    const insetWidth = inset?.getBoundingClientRect().width ?? 0;
    const visibleChats = chats.map((chat) => chat.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => a.left - b.left || a.top - b.top);
    const chatWidth = visibleChats[0]?.width ?? insetWidth;
    // Compare the pane's width with the sidebar closed. Adding back its share
    // of the spacer keeps opening/closing from changing the layout decision.
    const gapWidth = gap?.getBoundingClientRect().width ?? 0;
    const availableWidth = insetWidth > 0 ? chatWidth * (insetWidth + gapWidth) / insetWidth : 0;
    root.toggleAttribute("data-threadflow-sidebar-floating", availableWidth >= FLOATING_CHAT_MIN_WIDTH);
  };
  const schedule = () => {
    if (frame === undefined) frame = window.requestAnimationFrame(update);
  };
  const resize = new ResizeObserver(schedule);
  const mutation = new MutationObserver(schedule);
  mutation.observe(document.body, { childList: true, subtree: true });
  update();
  const cleanup = () => {
    resize.disconnect();
    mutation.disconnect();
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    root.removeAttribute("data-threadflow-sidebar-floating");
  };
  signal.addEventListener("abort", cleanup, { once: true });
  return cleanup;
}
