import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { SidebarFooter } from "./sidebar-usage";
export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "usage-insights",
    title: "Usage insights",
    component: SidebarFooter,
  });
  app.experimental_sidebarFooter.register({
    kind: "disclosure",
    id: "usage-insights",
    label: "Usage insights",
    icon: "ChartColumn",
    component: SidebarFooter,
  });
});
