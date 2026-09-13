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
  const slot = renderSlot({ component }, {}, {
    composer: { scope: { kind: "new-thread", projectId: null }, text: "Review" },
    rpc: { prompt_history: () => ({ prompts: ["Review the changes"] }) },
  });
  await waitFor(() => slot.getByText("Tab / →"));

  const textarea = document.createElement("textarea");
  textarea.value = "Review";
  document.body.append(textarea);
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  fireEvent.keyDown(textarea, { key: "ArrowRight" });

  expect(slot.inspection.composer.text).toBe("Review the changes");
  slot.lifecycle.unmount();
});
