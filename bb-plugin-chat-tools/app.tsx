import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ComposerBridge } from "./chat-composer";
import { NativeThreadHeader } from "./chat-header";
import { NativeSideChatPanel } from "./side-chat";
import { registerChatDecorations } from "./chat-decoration";
export default definePluginApp((app) => {
  registerChatDecorations(app);
  app.composer.customize({
    id: "chat-tools",
    scopes: ["thread", "new-thread"],
    banners: [{ id: "bridge", chrome: "bare", component: ComposerBridge }],
  });
  app.slots.experimental_threadHeaderAction({
    id: "thread-status",
    title: "Thread status",
    component: NativeThreadHeader,
  });
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    id: "side-chat",
    title: "Side chat",
    icon: "MessageQuestion",
    component: NativeSideChatPanel,
    layout: "flush",
  });
});
