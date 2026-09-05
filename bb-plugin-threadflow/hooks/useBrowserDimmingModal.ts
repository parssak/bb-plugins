import { useEffect } from "react";

type BrowserState = { tabId: string };

type DesktopBrowserApi = {
  onState(listener: (state: BrowserState) => void): () => void;
  onFocus?(listener: (tabId: string) => void): () => void;
  setVisibleWithoutFocus?(request: { tabId: string; visible: boolean }): void;
};

type TrackedTab = { tabId: string; touchedAt: number };

let activeModalCount = 0;
let trackingConsumerCount = 0;
let stopTracking: (() => void) | null = null;
let stopTrackingFocus: (() => void) | null = null;
const trackedTabs = new Map<string, TrackedTab>();
const tabsToRestore = new Set<string>();

function getBrowserApi(): DesktopBrowserApi | null {
  const desktopWindow = window as typeof window & {
    bbDesktop?: { browser?: DesktopBrowserApi };
  };
  return desktopWindow.bbDesktop?.browser ?? null;
}

function rememberTab(tabId: string): void {
  trackedTabs.set(tabId, { tabId, touchedAt: Date.now() });
}

function visibleBrowserPaneCount(): number {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-app-browser]")).filter((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }).length;
}

function ensureBrowserTracking(): DesktopBrowserApi | null {
  const browser = getBrowserApi();
  if (browser === null || stopTracking !== null) return browser;

  stopTracking = browser.onState(({ tabId }) => {
    rememberTab(tabId);
    if (activeModalCount > 0) {
      tabsToRestore.add(tabId);
      browser.setVisibleWithoutFocus?.({ tabId, visible: false });
    }
  });
  stopTrackingFocus = browser.onFocus?.(rememberTab) ?? null;
  return browser;
}

function retainBrowserTracking(): void {
  trackingConsumerCount += 1;
  ensureBrowserTracking();
}

function releaseBrowserTracking(): void {
  trackingConsumerCount = Math.max(0, trackingConsumerCount - 1);
  if (trackingConsumerCount > 0) return;

  stopTracking?.();
  stopTrackingFocus?.();
  stopTracking = null;
  stopTrackingFocus = null;
  restoreNativeBrowserViews();
  activeModalCount = 0;
  trackedTabs.clear();
  tabsToRestore.clear();
}

function hideNativeBrowserViews(): void {
  const browser = ensureBrowserTracking();
  if (browser?.setVisibleWithoutFocus === undefined) return;

  const paneCount = visibleBrowserPaneCount();
  const mostRecentTabs = [...trackedTabs.values()]
    .sort((left, right) => right.touchedAt - left.touchedAt)
    .slice(0, paneCount);
  tabsToRestore.clear();
  for (const { tabId } of mostRecentTabs) tabsToRestore.add(tabId);
  for (const tabId of trackedTabs.keys()) {
    browser.setVisibleWithoutFocus({ tabId, visible: false });
  }
}

function restoreNativeBrowserViews(): void {
  const browser = getBrowserApi();
  if (browser?.setVisibleWithoutFocus === undefined) return;
  for (const tabId of tabsToRestore) {
    browser.setVisibleWithoutFocus({ tabId, visible: true });
  }
  tabsToRestore.clear();
}

export function useBrowserDimmingModal(active: boolean): void {
  useEffect(() => {
    retainBrowserTracking();
    return releaseBrowserTracking;
  }, []);

  useEffect(() => {
    if (!active) return;

    activeModalCount += 1;
    if (activeModalCount === 1) hideNativeBrowserViews();
    return () => {
      activeModalCount = Math.max(0, activeModalCount - 1);
      if (activeModalCount === 0) restoreNativeBrowserViews();
    };
  }, [active]);
}

export function useIsBrowserDimmingModalOpen(): boolean {
  return activeModalCount > 0;
}
