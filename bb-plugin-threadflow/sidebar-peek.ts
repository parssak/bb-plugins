// Use the host toggle so lazily mounted sidebar content and keyboard navigation
// remain available. Only restore closed state when this gesture opened it.
export function mountSidebarPeek({ signal }: { signal: AbortSignal }) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let peeking = false;
  let released = false;
  let closing = false;
  let opened = false;
  const root = document.documentElement;
  const panel = () => document.querySelector<HTMLElement>('[data-sidebar="panel"]');
  const isOpen = () => {
    const element = panel();
    return element?.hasAttribute("data-vaul-drawer-direction")
      ? element.dataset.state === "open"
      : element?.parentElement?.dataset.state === "expanded";
  };
  const trigger = () => document.querySelector<HTMLButtonElement>('[data-sidebar="trigger"]');
  const cancelTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const clearPeek = () => {
    peeking = false;
    root.removeAttribute("data-threadflow-sidebar-peek");
    if (signal.aborted) observer.disconnect();
  };
  // Compact drawers finish opening/closing asynchronously. A quick release
  // must still close the drawer once its pending open has completed.
  const reconcile = () => {
    if (!peeking) return;
    const open = isOpen();
    if (open) opened = true;
    if (opened && !open) clearPeek();
    else if (released && !closing && open) {
      closing = true;
      trigger()?.click();
      if (!isOpen()) clearPeek();
    }
  };
  const observer = new MutationObserver(reconcile);
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
  const finish = () => {
    cancelTimer();
    released = true;
    reconcile();
    if (signal.aborted && !peeking) observer.disconnect();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Meta" && !event.repeat && !event.altKey && !event.ctrlKey && !event.shiftKey) {
      if (timer !== undefined || peeking || isOpen()) return;
      timer = setTimeout(() => {
        timer = undefined;
        const button = trigger();
        if (!panel() || !button || isOpen()) return;
        peeking = true;
        released = false;
        closing = false;
        opened = false;
        root.setAttribute("data-threadflow-sidebar-peek", "");
        button.click();
        reconcile();
      }, 200);
      return;
    }
    cancelTimer();
    // Cmd+B while peeking pins it open, just as Cmd+B from closed normally does.
    if (peeking && event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
      && event.key.toLowerCase() === "b" && !event.repeat) {
      clearPeek();
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === "Meta" || !event.metaKey) finish();
  };
  const onVisibilityChange = () => { if (document.hidden) finish(); };
  window.addEventListener("keydown", onKeyDown, { capture: true, signal });
  window.addEventListener("keyup", onKeyUp, { capture: true, signal });
  window.addEventListener("blur", finish, { signal });
  document.addEventListener("visibilitychange", onVisibilityChange, { signal });
  signal.addEventListener("abort", finish, { once: true });
  return finish;
}
