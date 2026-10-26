// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { useComposer } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { WaitComposerBridge } from "./wait-status";
afterEach(cleanup);

let submit: () => Promise<void> = async () => {};
function ComposerHarness() {
  const composer = useComposer();
  submit = () => composer.submit({});
  return <WaitComposerBridge />;
}

async function renderComposer() {
  await loadPluginApp(() => import("./app"));
  const returns: unknown[] = [];
  const onReturn = (event: Event) =>
    returns.push((event as CustomEvent<unknown>).detail);
  window.addEventListener("threadflow:return-to-sidebar", onReturn);
  const slot = renderSlot(
    { component: ComposerHarness },
    {},
    {
      context: { threadId: "one" },
      composer: { text: "hello" },
      rpc: {
        active_threadflow_wait: () => ({ wait: null, queuedWait: null }),
      },
    },
  );
  return {
    slot,
    returns,
    dispose: () =>
      window.removeEventListener("threadflow:return-to-sidebar", onReturn),
  };
}

test("sending a message typed in the composer keeps focus in the chat", async () => {
  const { returns, dispose } = await renderComposer();
  await act(() => submit());
  expect(returns).toEqual([]);
  dispose();
});

test("sending a message started from a sidebar row returns to the sidebar once", async () => {
  const { slot, returns, dispose } = await renderComposer();
  const detail = { threadId: "one", text: "h", handled: false };
  act(() => {
    window.dispatchEvent(
      new CustomEvent("threadflow:type-in-chat", { detail }),
    );
  });
  expect(detail.handled).toBe(true);
  await act(() => submit());
  act(() => slot.behavior.setComposerText("again"));
  await act(() => submit());
  expect(returns).toEqual(["one"]);
  dispose();
});
