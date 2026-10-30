// Dev Server header controls. Everything renders through BB's own thread
// header split button: the first visible action is the main button and the
// rest fill its menu, so the button reads Run dev → Starting dev… → Open app.
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  definePluginApp,
  experimental_copyToClipboard,
  experimental_useRpcKeyedQuery,
  useRpc,
  useSettings,
  type BbNavigate,
  type PluginRpcClient,
  type PluginThreadAction,
  type PluginThreadActionDataInput,
} from "@get-bb/plugin-sdk/app";
import { rpcContract, threadIdSchema, type DevServerStatus } from "./contract.ts";

interface Data {
  statuses: Record<string, DevServerStatus>;
  rpc: PluginRpcClient<typeof rpcContract>;
  showLogsOnStart: boolean;
}

interface ActionContext {
  threadId: string;
  status: DevServerStatus;
  data: Data;
  navigate: BbNavigate;
}

const ICON = {
  play: "dev-server-play",
  spinner: "dev-server-spinner",
  live: "dev-server-live",
  terminal: "dev-server-terminal",
  copy: "dev-server-copy",
  restart: "dev-server-restart",
  stop: "dev-server-stop",
} as const;

function useDevServerData({ threadIds }: PluginThreadActionDataInput): Data {
  const rpc = useRpc<typeof rpcContract>();
  const { values } = useSettings();
  const keys = threadIds.filter((id) => threadIdSchema.safeParse(id).success).slice(0, 32);
  const { data } = experimental_useRpcKeyedQuery({
    contract: rpcContract,
    method: "status",
    keys,
  });
  return {
    statuses: data ?? {},
    rpc,
    showLogsOnStart: values?.showLogsOnStart !== false,
  };
}

const running = (status: DevServerStatus) =>
  status.state === "starting" || status.state === "ready";

function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function showLogs({ status, navigate }: ActionContext) {
  if (status.terminalId && (await navigate.experimental_openTerminal({ terminalId: status.terminalId }))) {
    return;
  }
  if (
    status.logPath &&
    status.environmentId &&
    navigate.experimental_openFilePreview({
      target: { kind: "workspace", environmentId: status.environmentId, path: status.logPath },
      location: null,
    })
  ) {
    return;
  }
  toast.message("This dev server was started from another thread, so its terminal is there.");
}

async function launch({ threadId, data, navigate }: ActionContext, method: "start" | "restart") {
  try {
    const { terminalId } = await data.rpc.call(method, { threadId });
    if (data.showLogsOnStart) await navigate.experimental_openTerminal({ terminalId });
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

async function stop({ threadId, data }: ActionContext) {
  try {
    const { stopped } = await data.rpc.call("stop", { threadId });
    if (!stopped) toast.message("Nothing to stop for this checkout.");
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

function openApp(context: ActionContext) {
  const { url } = context.status;
  if (url && context.navigate.openUrl(url)) return;
  toast.error(url ? `BB could not open ${url}.` : "This dev server has not reported a URL yet.");
}

async function copyUrl({ status }: ActionContext) {
  if (!status.url) return;
  if (await experimental_copyToClipboard({ text: status.url })) toast.success("Copied dev URL");
  else toast.error("Could not copy the URL.");
}

const ACTIONS: ReadonlyArray<{
  id: string;
  title: string;
  icon: string;
  item(context: ActionContext): PluginThreadAction | null;
}> = [
  {
    // Main button while the server is up or changing state.
    id: "dev-status",
    title: "Dev server status",
    icon: ICON.live,
    item(context) {
      const { status } = context;
      switch (status.state) {
        case "starting":
          return {
            label: "Starting dev…",
            detail: status.url ? hostLabel(status.url) : "./dev.sh",
            icon: ICON.spinner,
            run: () => showLogs(context),
          };
        case "stopping":
          return { label: "Stopping dev…", icon: ICON.spinner, disabled: true, run: () => {} };
        case "ready":
          return {
            label: "Open app",
            detail: status.url ? hostLabel(status.url) : undefined,
            icon: ICON.live,
            disabled: status.url === null,
            run: () => openApp(context),
          };
        default:
          return null;
      }
    },
  },
  {
    id: "dev-run",
    title: "Run dev",
    icon: ICON.play,
    item(context) {
      const { status } = context;
      if (status.state !== "stopped" && status.state !== "failed") return null;
      return {
        label: "Run dev",
        detail:
          status.state === "failed" && status.exitCode !== null
            ? `Last run exited with code ${status.exitCode}`
            : "./dev.sh",
        icon: ICON.play,
        run: () => launch(context, "start"),
      };
    },
  },
  {
    id: "dev-logs",
    title: "Show dev logs",
    icon: ICON.terminal,
    item(context) {
      const { status } = context;
      const hasLogs = status.terminalId !== null || (status.logPath !== null && running(status));
      if (!hasLogs || status.state === "stopping") return null;
      return { label: "Show logs", icon: ICON.terminal, run: () => showLogs(context) };
    },
  },
  {
    id: "dev-copy-url",
    title: "Copy dev URL",
    icon: ICON.copy,
    item(context) {
      const { status } = context;
      if (!running(status) || status.url === null) return null;
      return { label: "Copy URL", detail: status.url, icon: ICON.copy, run: () => copyUrl(context) };
    },
  },
  {
    id: "dev-restart",
    title: "Restart dev",
    icon: ICON.restart,
    item(context) {
      if (!running(context.status)) return null;
      return { label: "Restart dev", icon: ICON.restart, run: () => launch(context, "restart") };
    },
  },
  {
    id: "dev-stop",
    title: "Stop dev",
    icon: ICON.stop,
    item(context) {
      if (!running(context.status)) return null;
      return {
        label: "Stop dev",
        icon: ICON.stop,
        variant: "destructive",
        run: () => stop(context),
      };
    },
  },
];

function Glyph({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const GLYPHS: Record<(typeof ICON)[keyof typeof ICON], (props: { className?: string }) => ReactNode> = {
  [ICON.play]: ({ className }) => (
    <Glyph className={className}>
      <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" />
    </Glyph>
  ),
  [ICON.spinner]: ({ className }) => (
    <Glyph className={className}>
      <path d="M21 12a9 9 0 1 1-6.22-8.56">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </path>
    </Glyph>
  ),
  // A fixed green so "running" reads at a glance in any theme.
  [ICON.live]: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="#22c55e" opacity="0.22" />
      <circle cx="12" cy="12" r="5" fill="#22c55e" />
    </svg>
  ),
  [ICON.terminal]: ({ className }) => (
    <Glyph className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m7 11 2-2-2-2" />
      <path d="M11 13h4" />
    </Glyph>
  ),
  [ICON.copy]: ({ className }) => (
    <Glyph className={className}>
      <rect x="8" y="8" width="14" height="14" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Glyph>
  ),
  [ICON.restart]: ({ className }) => (
    <Glyph className={className}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </Glyph>
  ),
  [ICON.stop]: ({ className }) => (
    <Glyph className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Glyph>
  ),
};

export default definePluginApp((app) => {
  for (const [name, Component] of Object.entries(GLYPHS)) {
    app.experimental_icons.register({ name, component: Component });
  }
  ACTIONS.forEach((action, order) => {
    app.slots.experimental_threadAction<Data>({
      id: action.id,
      title: action.title,
      icon: action.icon,
      group: "dev-server",
      order,
      placement: "header",
      useData: useDevServerData,
      item: ({ thread, data, navigate }) => {
        const status = data.statuses[thread.id];
        if (!status || status.state === "unavailable") return null;
        return action.item({ threadId: thread.id, status, data, navigate });
      },
    });
  });
});
