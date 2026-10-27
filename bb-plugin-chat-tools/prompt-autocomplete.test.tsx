// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { isCaretAtTextEnd } from "./prompt-autocomplete";

afterEach(() => {
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

test("recognizes the end of textarea input", () => {
  const textarea = document.createElement("textarea");
  textarea.value = "Review the changes";
  document.body.append(textarea);

  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  expect(isCaretAtTextEnd(textarea)).toBe(true);

  textarea.setSelectionRange(6, 6);
  expect(isCaretAtTextEnd(textarea)).toBe(false);
});

test("recognizes the end of contenteditable input", () => {
  const editor = document.createElement("div");
  editor.contentEditable = "true";
  editor.textContent = "Review the changes";
  document.body.append(editor);
  const text = editor.firstChild!;
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.setStart(text, text.textContent!.length);
  range.collapse(true);
  selection.addRange(range);
  expect(isCaretAtTextEnd(editor)).toBe(true);

  range.setStart(text, 6);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  expect(isCaretAtTextEnd(editor)).toBe(false);
});

test("Right Arrow accepts a valid composer suggestion", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const component = app.composerCustomizations[0]!.banners![0]!.component;
  const slot = renderSlot(
    { component },
    {},
    {
      composer: {
        scope: { kind: "new-thread", projectId: null },
        text: "Review",
      },
      rpc: { prompt_history: () => ({ prompts: ["Review the changes"] }) },
    },
  );
  await waitFor(() => slot.getByText("Tab / →"));

  const textarea = document.createElement("textarea");
  textarea.value = "Review";
  document.body.append(textarea);
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  fireEvent.keyDown(textarea, { key: "ArrowRight" });

  expect(slot.inspection.composer.text).toBe("Review the changes");
  slot.lifecycle.unmount();
});

test("Command-Shift-E creates a review and opens the registered side-chat tab", async () => {
  const app = await loadPluginApp(() => import("./app"));
  expect(app.tabs).toContainEqual(expect.objectContaining({
    id: "side-chat",
    context: { kind: "thread" },
    availability: "action",
  }));
  const slot = renderSlot(
    { component: app.composerCustomizations[0]!.banners![0]!.component },
    {},
    {
      composer: { scope: { kind: "thread", threadId: "source" }, text: "" },
      rpc: {
        prompt_history: () => ({ prompts: [] }),
        user_message_timestamps: () => ({ messages: [] }),
        chat_summary: () => ({ summary: null }),
        set_viewing_thread: () => ({ ok: true }),
        create_side_chat: (input) => {
          expect(input).toEqual({
            sourceThreadId: "source",
            initialMessage: "Review the changes in this worktree",
            title: "Review",
          });
          return { thread: { id: "review" } };
        },
      },
      openThreadPanel: () => true,
    },
  );
  try {
    fireEvent.keyDown(document.body, { key: "E", metaKey: true, shiftKey: true });
    await waitFor(() => expect(slot.inspection.navigateCalls).toContainEqual({
      method: "openThreadPanel",
      options: { actionId: "side-chat", title: "Review", params: { childThreadId: "review" } },
    }));
  } finally {
    slot.lifecycle.unmount();
  }
});
