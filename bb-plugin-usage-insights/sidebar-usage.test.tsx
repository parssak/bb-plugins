// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
afterEach(cleanup);

test("Claude limits remain visible when Codex usage is unavailable", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        provider_usage: ({ providerId }) =>
          providerId === "codex"
            ? {
                status: "unavailable",
                message: "Sign in to Codex to see usage",
              }
            : {
                status: "ok",
                planLabel: "Max",
                windows: [
                  { label: "Current session", usedPercent: 40, resetsAt: null },
                  { label: "Weekly limit", usedPercent: 25, resetsAt: null },
                ],
                todayUsage: { coverage: "partial-day", usedPercent: 3 },
              },
      },
    },
  );
  const session = await slot.findByRole("progressbar", {
    name: "Claude Code Current session usage",
  });
  expect(session.getAttribute("aria-valuenow")).toBe("40");
  expect(
    slot
      .getByRole("progressbar", { name: "Claude Code Weekly limit usage" })
      .getAttribute("aria-valuenow"),
  ).toBe("25");
  expect(slot.getByText("Sign in to Codex to see usage")).toBeTruthy();
  expect(slot.getByText("≥3% today")).toBeTruthy();
  expect(
    slot.inspection.rpcCalls.map((c) => c.input.providerId).sort(),
  ).toEqual(["claude-code", "codex"]);
  slot.lifecycle.unmount();
});
