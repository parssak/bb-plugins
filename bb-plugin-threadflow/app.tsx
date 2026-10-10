import { definePluginApp, useBbContext } from "@get-bb/plugin-sdk/app";
import { CompactThreadList } from "./sidebar";
import { WaitComposerBridge } from "./wait-status";
import { ContextSwitchGuard } from "./context-switch-guard";
import { mountSidebarPeek } from "./sidebar-peek";
function ContextSwitchOverlay() {
  const { threadId } = useBbContext();
  return <ContextSwitchGuard activeThreadId={threadId} />;
}
export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "compact-thread-list",
    title: "Threadflow",
    component: CompactThreadList,
  });
  app.slots.experimental_appOverlay({
    id: "context-switch-guard",
    component: ContextSwitchOverlay,
  });
  app.contentScripts.register({ id: "sidebar-peek", mount: mountSidebarPeek });
  app.composer.customize({
    id: "wait-status",
    scopes: ["thread"],
    banners: [{ id: "wait", chrome: "bare", component: WaitComposerBridge }],
  });
});
