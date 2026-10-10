import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  UrlLink,
  experimental_useSidebarThreadPullRequest,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type {
  PluginSidebarPullRequest,
  PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contract";
import {
  parseThreadTitleBrand,
  type ThreadTitleBrand,
} from "./thread-title-brand";

type ChatTarget = {
  id: string;
  title: string;
  createdAt: number;
  project?: string;
  worktree: string | null;
  sourceThreadId?: string;
  accentTitle?: string;
  accentCreatedAt?: number;
};

const BB_LOGO_DATA_URL =
  "data:image/webp;base64," +
  "UklGRqwDAABXRUJQVlA4TKADAAAvL8ALEJUGQbbN66+9nCEiJmANn1izbSRJUf5Rt3OzR/9vHz1TBKMAYJQc7pJB+0CbNVkBnhTY" +
  "E9cW64CDI7eNHImeueWwrn2DbEmyTdt6t7m5ONexbdu2bfuca9u2bdu2bdvWwlxx/8A6EhAU+T/aBPSfgdtGirzHDJ19RFm6oGDg4" +
  "BEQSo5yYlwR0MkoAJAKomFkZmVzUs66Qe0C/uMLgUXeYG7+wDxw69WLiJL9jsozDt9KfUfnspc67q/QRrX0J4WnWydqd5K0T5HBa" +
  "TyH+q2zvuIAm/sA3p5fAbd6zjBcMSCfpzC85zIneQFseBRo2GactlBYcA7aWxYYU5d24iUQoH6rxpZvmGS0doD5eh/aKbJ1x7QO" +
  "XAR2oHzDGJC6QzdDsBSxgg/QlpmIG0b6ehcICMOFQ6MOkocHhoidDuOew4zQEWCp74GgOV14jGo2oVoNGcUJaLdXgY/mYkyjBYK" +
  "xuAiYde9a7CWnPkeWO2K1VtF3I4jARmL6O+5HWrgXmQ8XIas4S4DUkJloP/P91JryZDTHHoD6PNnHZGpWSCfmcQU2VkLBJhaij4n" +
  "BBumkCfgFU73yzADqXDRTTKYz4chZ6GM+q/cWJjavD1RivUJzibr3Q5a3bC3UGECkLmCCaSocMTM9iVqiaVsrX3eIWJ4NFpnueK/" +
  "ylnecJQoBRtMX3Q9Ds+hLZ1JINMmI5XEfnnYRQ9GKLWQNjL9eBo6RQNTw7eQNH/mzlWxi9MON3fI0iTATjN1IGD/iIQFQUOILhpG" +
  "qlzTpr71GWwo/T8jVbe76cZQW2mHMwMQ1dC0fob2jM7bqi7IYFsiFTuCiqYaG+BCGCUhEhi6B5zA8IxWgSKnbYV0IkpN1GgH2Lc" +
  "AO2j1C+IOPoAcfYTiAOYKpaLWbsHICyeEaKZAJZ7zjtLS0vKQrqOSMQOwCM2oFaKo6WWtg5xCS86OYTIDOtJbKMW6xnyoNMZglHf" +
  "IL2EO+eEBnRKhMbnoch51zSB29IHVaEyhEMjsCcMQMG11xUlN5kVWzk8PMIwlEjSmq+Ulw1BGsTvfpqHgYFIZazF53fOqLjgpKZ4" +
  "Yn4QRpC0CMuqIN9C0cdertgf1maTtzbOaoB+E0soGK6WqJDxGE8tcSEsmcN5d3cPQDAT3znH3MYDijWZRTvKblBYsoI4VYgnDV2S" +
  "iGcQXOfsbssYA84ww72MAWTvIESD+WvifT93Dynk8/R5LPqeRzMPmcTT3H0/5PWLgU";

const THREAD_HEADER_TITLE_HOST_ATTRIBUTE = "data-threadflow-header-title-host";

const THREAD_HEADER_TITLE_CONTENT_ATTRIBUTE =
  "data-threadflow-header-title-content";

function threadAccent(title: string, createdAt: number): { color: string } {
  const seed = `${title}\u0000${createdAt}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  const unsignedHash = hash >>> 0;
  const hue = unsignedHash % 360;
  return {
    color: `light-dark(oklch(52% 0.22 ${hue}), oklch(76% 0.18 ${hue}))`,
  };
}

function PullRequestLink({
  pullRequest,
}: {
  pullRequest: PluginSidebarPullRequest;
}) {
  return (
    <UrlLink
      href={pullRequest.url}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none hover:brightness-125 ${pullRequestColor(pullRequest.attention)}`}
      aria-label={`Open pull request ${pullRequest.number}: ${pullRequest.title}`}
      title={`Open PR #${pullRequest.number}: ${pullRequest.title}`}
    >
      <span>#{pullRequest.number}</span>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        className="size-3"
      >
        <path
          d="M6 4h6v6M12 4 5 11"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </UrlLink>
  );
}

type WorktreeChanges = {
  baseBranch: string;
  fileCount: number;
  additions: number;
  deletions: number;
};

function WorktreeChangesBadge({ changes }: { changes: WorktreeChanges }) {
  const filesLabel = `${changes.fileCount} ${changes.fileCount === 1 ? "file" : "files"}`;
  const detail = `${filesLabel} differ from ${changes.baseBranch}: ${changes.additions} additions, ${changes.deletions} deletions`;
  return (
    <span
      className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground"
      title={detail}
      aria-label={detail}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        className="size-3"
      >
        <path
          d="M3 4.5h3M4.5 3v3M10 4.5h3M10 11.5h3"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
      <span>{changes.fileCount}</span>
      <span aria-hidden="true">·</span>
      <span>+{changes.additions}</span>
      <span>−{changes.deletions}</span>
    </span>
  );
}

function ChatAccentHeader({
  target,
  compact = false,
}: {
  target: ChatTarget;
  compact?: boolean;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const sourceThreadId = target.sourceThreadId ?? target.id;
  const { pullRequest } =
    experimental_useSidebarThreadPullRequest(sourceThreadId);
  const [worktreeChanges, setWorktreeChanges] =
    useState<WorktreeChanges | null>(null);
  const [checks, setChecks] = useState<
    | {
        state: "failing" | "no_checks" | "passing" | "pending" | "unknown";
        failedCount: number;
        pendingCount: number;
        totalCount: number;
      }
    | null
    | undefined
  >(undefined);
  const accent = threadAccent(
    target.accentTitle ?? target.title,
    target.accentCreatedAt ?? target.createdAt,
  );
  const project = target.project ?? "Personal";
  const label =
    target.sourceThreadId !== undefined && target.title === "Review"
      ? "Review"
      : project === "usebogi.com"
        ? null
        : project;

  useEffect(() => {
    if (pullRequest === null) {
      setChecks(undefined);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const result = await rpc.call("pull_request_checks", {
          threadId: sourceThreadId,
        });
        if (!cancelled) setChecks(result.checks);
      } catch {
        if (!cancelled) setChecks(null);
      }
    };
    setChecks(undefined);
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pullRequest?.number, rpc, sourceThreadId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await rpc.call("worktree_changes", {
          threadId: sourceThreadId,
        });
        if (!cancelled) setWorktreeChanges(result.changes);
      } catch {
        if (!cancelled) setWorktreeChanges(null);
      }
    };
    setWorktreeChanges(null);
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [rpc, sourceThreadId]);

  const checksLabel =
    pullRequest?.state === "merged"
      ? null
      : checks === undefined
        ? "Checking…"
        : checks === null || checks.state === "unknown"
          ? "Checks unknown"
          : checks.state === "failing"
            ? `${checks.failedCount || "Some"} failed`
            : checks.state === "pending"
              ? `${checks.pendingCount || "Some"} pending`
              : null;

  if (
    !compact &&
    label === null &&
    pullRequest === null &&
    worktreeChanges === null
  ) {
    return (
      <div
        className="h-1 shrink-0"
        style={{ backgroundColor: accent.color }}
        aria-hidden="true"
      />
    );
  }
  return (
    <div
      className={
        compact
          ? "flex h-7 min-w-0 items-center gap-1.5 text-[10px] font-medium"
          : "flex shrink-0 items-center gap-2 px-3 py-1.5 text-[11px] font-medium"
      }
      style={{ color: accent.color }}
    >
      {compact ? null : label === null ? null : (
        <>
          <span
            className="h-px w-3"
            style={{ backgroundColor: accent.color }}
            aria-hidden="true"
          />
          <span>{label}</span>
        </>
      )}
      {compact ? null : (
        <span
          className={label === null ? "h-1 flex-1" : "h-px flex-1"}
          style={{ backgroundColor: accent.color }}
          aria-hidden="true"
        />
      )}
      {worktreeChanges === null ? null : (
        <WorktreeChangesBadge changes={worktreeChanges} />
      )}
      {pullRequest === null || checksLabel === null ? null : (
        <span
          className={`shrink-0 text-[10px] font-medium ${checks?.state === "failing" ? "text-red-500" : checks?.state === "pending" ? "text-amber-500" : "text-muted-foreground"}`}
        >
          {checksLabel}
        </span>
      )}
      {pullRequest === null ? null : (
        <PullRequestLink pullRequest={pullRequest} />
      )}
    </div>
  );
}

export function NativeThreadHeader({
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<ChatTarget | null>(null);
  const [titleHost, setTitleHost] = useState<HTMLElement | null>(null);
  const brandedTitle =
    target === null ? null : parseThreadTitleBrand(target.title);

  useEffect(() => {
    let cancelled = false;
    void rpc
      .call("thread_context", { threadId })
      .then((result) => {
        if (!cancelled) setTarget(result.target);
      })
      .catch(() => {
        if (!cancelled) setTarget(null);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId]);

  useEffect(() => {
    if (target === null || brandedTitle?.brand === null) {
      setTitleHost(null);
      return;
    }
    const anchor = anchorRef.current;
    const row = anchor?.closest<HTMLElement>(
      '[data-testid="app-page-header-content-row"]',
    );
    if (
      anchor === null ||
      anchor === undefined ||
      row === null ||
      row === undefined
    )
      return;
    const locate = () => {
      setTitleHost((current) =>
        current !== null && current.isConnected && row.contains(current)
          ? current
          : findThreadHeaderTitleHost(anchor, target.title),
      );
    };
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(row, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [brandedTitle?.brand, target]);

  useEffect(() => {
    if (titleHost === null) return;
    titleHost.setAttribute(THREAD_HEADER_TITLE_HOST_ATTRIBUTE, "");
    return () => titleHost.removeAttribute(THREAD_HEADER_TITLE_HOST_ATTRIBUTE);
  }, [titleHost]);

  if (target === null) return null;
  return (
    <>
      <div
        ref={anchorRef}
        className={
          isCompactViewport
            ? "max-w-28 overflow-hidden"
            : "max-w-[38rem] overflow-hidden"
        }
      >
        <ChatAccentHeader target={target} compact />
      </div>
      {titleHost === null ||
      brandedTitle === null ||
      brandedTitle.brand === null
        ? null
        : createPortal(
            <span
              data-bb-plugin="threadflow"
              {...{ [THREAD_HEADER_TITLE_CONTENT_ATTRIBUTE]: "" }}
            >
              <ThreadBrandMark
                brand={brandedTitle.brand}
                className="size-[0.85em]"
              />
              <span className="min-w-0 truncate">{brandedTitle.title}</span>
            </span>,
            titleHost,
          )}
    </>
  );
}

function pullRequestColor(attention: string): string {
  if (attention === "ready_to_merge")
    return "border-green-500/40 bg-green-500/10 text-green-500";
  if (
    ["blocked", "changes_requested", "checks_failed", "conflicts"].includes(
      attention,
    )
  ) {
    return "border-red-500/40 bg-red-500/10 text-red-500";
  }
  if (["checks_pending", "review_requested"].includes(attention)) {
    return "border-amber-500/40 bg-amber-500/10 text-amber-500";
  }
  if (attention === "merged")
    return "border-violet-500/40 bg-violet-500/10 text-violet-500";
  return "border-border bg-muted text-muted-foreground";
}

function ThreadBrandMark({
  brand,
  className = "size-3",
}: {
  brand: ThreadTitleBrand;
  className?: string;
}) {
  const label = brand === "bb" ? "BB" : "Bogi";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
    >
      {brand === "bb" ? (
        <img
          src={BB_LOGO_DATA_URL}
          alt=""
          className="size-full rounded-[0.18em]"
        />
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 300 326"
          fill="none"
          className="size-full"
        >
          <g transform="translate(300 0) scale(-1 1)">
            <path
              d="M104.494 309.332C81.9045 296.235 59.7038 283.197 37.3073 270.505C13.0366 256.75 0.433367 236.144 0.224508 208.26C-0.00384286 177.773 -0.0973071 147.283 0.133253 116.796C0.342505 89.128 13.0094 68.5206 36.8846 54.7555C62.3559 40.0703 87.9548 25.605 113.356 10.7997C137.819 -3.45937 162.055 -3.68356 186.583 10.6332C212.68 25.8651 239.031 40.6613 265.112 55.9189C287.205 68.8437 299.395 88.3415 299.859 113.936C300.453 146.734 300.326 179.561 299.681 212.36C299.206 236.534 288.466 255.42 267.175 267.729C238.274 284.437 209.56 301.483 180.381 317.692C161.393 328.24 141.518 328.02 121.894 318.761C116.047 316.002 110.488 312.632 104.494 309.332ZM192.607 143.085C186.277 146.736 180.054 150.59 173.593 153.991C163.544 159.282 159.086 167.356 159.315 178.719C159.694 197.531 159.551 216.354 159.593 235.173C159.625 249.498 159.401 263.827 159.664 278.147C159.905 291.344 169.674 297.19 181.588 291.593C182.937 290.959 184.217 289.173 185.511 289.426C202.621 279.543 219.761 269.708 236.824 259.744C245.704 254.559 255.091 249.961 263.125 243.664C281.704 229.103 281.697 200.634 263.998 185.635C262.913 184.715 262.43 181.679 263.101 180.354C265.192 176.225 267.862 172.37 270.51 168.549C275.122 161.892 277.336 154.675 276.966 146.502C276.651 139.525 276.781 132.514 277.019 125.528C277.255 118.64 275.067 113.05 269.082 109.412C262.972 105.699 256.726 106.083 250.633 109.602C231.506 120.65 212.396 131.728 192.607 143.085ZM42.4736 223.875C46.6551 226.264 50.8341 228.658 55.0187 231.042C61.2316 234.581 63.9591 233.036 63.9647 225.906C63.9831 202.918 63.7819 179.928 64.0689 156.944C64.1773 148.263 60.8115 142.279 53.2011 138.424C51.2805 137.452 49.4608 136.28 47.5922 135.204C38.9783 130.244 32.7558 133.734 32.742 143.596C32.7126 164.751 32.9865 185.911 32.5996 207.06C32.4585 214.774 34.6289 220.348 42.4736 223.875ZM86.733 188.428C86.7333 206.065 86.7809 223.702 86.7055 241.338C86.6827 246.678 88.7735 250.521 93.4947 253.117C99.0176 256.153 104.374 259.491 109.878 262.563C114.88 265.355 117.939 263.607 117.95 257.91C117.999 233.618 117.991 209.326 117.954 185.033C117.946 179.291 115.421 174.731 110.659 171.607C107.063 169.248 103.327 167.062 99.4918 165.117C92.9672 161.809 86.9565 165.543 86.7592 172.953C86.6308 177.775 86.7337 182.603 86.733 188.428Z"
              fill="currentColor"
            />
          </g>
        </svg>
      )}
    </span>
  );
}

function findThreadHeaderTitleHost(
  anchor: HTMLElement,
  title: string,
): HTMLElement | null {
  const row = anchor.closest<HTMLElement>(
    '[data-testid="app-page-header-content-row"]',
  );
  const center = row?.firstElementChild;
  if (!(center instanceof HTMLElement)) return null;
  const candidates = [
    center,
    ...Array.from(center.querySelectorAll<HTMLElement>("*")),
  ];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]!;
    if (
      !candidate.hasAttribute(THREAD_HEADER_TITLE_CONTENT_ATTRIBUTE) &&
      candidate.textContent?.trim() === title
    )
      return candidate;
  }
  return null;
}
