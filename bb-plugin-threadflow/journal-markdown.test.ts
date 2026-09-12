import assert from "node:assert/strict";
import test from "node:test";
import { Editor } from "@tiptap/core";
import { JSDOM } from "jsdom";

import { journalMarkdownExtensions } from "./journal-markdown.ts";
import { threadReferenceHref } from "./thread-reference.ts";

test("round-trips task lists and ordinary markdown lists", () => {
  const markdown = "- [ ] Plan the day\n- [x] Clear the inbox\n\n- First priority\n- Second priority";
  const editor = new Editor({
    element: null,
    extensions: journalMarkdownExtensions(),
    content: markdown,
    contentType: "markdown",
  });

  assert.equal(editor.getMarkdown(), markdown);
  assert.deepEqual(editor.getJSON().content?.map((node) => node.type), ["taskList", "bulletList"]);
  assert.equal(editor.getJSON().content?.[0]?.content?.[0]?.attrs?.checked, false);
  assert.equal(editor.getJSON().content?.[0]?.content?.[1]?.attrs?.checked, true);
  editor.destroy();
});

test("serializes nested lists with two-space indentation", () => {
  const markdown = "- Parent\n  - Child\n\n- [ ] Task\n  - [ ] Nested task";
  const editor = new Editor({
    element: null,
    extensions: journalMarkdownExtensions(),
    content: markdown,
    contentType: "markdown",
  });

  assert.equal(editor.getMarkdown(), markdown);
  editor.destroy();
});

test("round-trips clickable thread references", () => {
  const markdown = `[Fix the header](${threadReferenceHref("thr_abc-123")})`;
  const editor = new Editor({
    element: null,
    extensions: journalMarkdownExtensions(),
    content: markdown,
    contentType: "markdown",
  });

  assert.equal(editor.getMarkdown(), markdown);
  assert.equal(editor.getJSON().content?.[0]?.content?.[0]?.marks?.[0]?.type, "link");
  editor.destroy();
});

test("round-trips editable markdown tables", () => {
  const markdown = "| Name | Status |\n| --- | --- |\n| Journal | Done |";
  const editor = new Editor({
    element: null,
    extensions: journalMarkdownExtensions(),
    content: markdown,
    contentType: "markdown",
  });

  assert.equal(editor.getJSON().content?.[0]?.type, "table");
  assert.equal(editor.getJSON().content?.[0]?.content?.[0]?.content?.[0]?.type, "tableHeader");
  assert.match(editor.getMarkdown(), /\| Name\s+\| Status \|/);
  assert.match(editor.getMarkdown(), /\| Journal \| Done\s+\|/);
  editor.destroy();
});

test("renders Mermaid code blocks without changing their Markdown", () => {
  const dom = new JSDOM('<div id="editor"></div>');
  const globals = {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    getComputedStyle: dom.window.getComputedStyle,
  };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }

  const markdown = "```mermaid\nflowchart TD\n  A --> B\n```";
  let renderedSource = "";
  try {
    const editor = new Editor({
      element: dom.window.document.querySelector("#editor"),
      extensions: journalMarkdownExtensions((host, source) => {
        renderedSource = source;
        host.textContent = "rendered diagram";
      }),
      content: markdown,
      contentType: "markdown",
    });

    assert.equal(renderedSource, "flowchart TD\n  A --> B");
    assert.equal(editor.getMarkdown(), markdown);
    assert.equal(dom.window.document.querySelector(".threadflow-journal-mermaid-preview")?.textContent, "rendered diagram");
    editor.destroy();
  } finally {
    dom.window.close();
    for (const key of Object.keys(globals)) delete (globalThis as Record<string, unknown>)[key];
  }
});

test("supports the journal table and indentation shortcuts", () => {
  const dom = new JSDOM('<div id="editor"></div><div id="indent-editor"></div>');
  const globals = {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    getComputedStyle: dom.window.getComputedStyle,
  };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }

  try {
    const editor = new Editor({
      element: dom.window.document.querySelector("#editor"),
      extensions: journalMarkdownExtensions(),
      content: "|---",
      contentType: "markdown",
    });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const { from, to } = editor.state.selection;
    let handled = false;
    editor.view.someProp("handleTextInput", (handler) => {
      if (!handler(editor.view, from, to, "|")) return false;
      handled = true;
      return true;
    });

    assert.equal(handled, true);
    assert.equal(editor.getJSON().content?.[0]?.type, "table");
    assert.equal(editor.getJSON().content?.[0]?.content?.length, 3);
    editor.destroy();

    const indentEditor = new Editor({
      element: dom.window.document.querySelector("#indent-editor"),
      extensions: journalMarkdownExtensions(),
      content: "Journal",
      contentType: "markdown",
    });
    indentEditor.commands.setTextSelection(indentEditor.state.doc.content.size - 1);
    const tab = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    indentEditor.view.dom.dispatchEvent(tab);
    assert.equal(tab.defaultPrevented, true);
    assert.equal(indentEditor.getMarkdown(), "Journal  ");
    const shiftTab = new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    indentEditor.view.dom.dispatchEvent(shiftTab);
    assert.equal(shiftTab.defaultPrevented, true);
    assert.equal(indentEditor.getMarkdown(), "Journal");
    indentEditor.destroy();
  } finally {
    dom.window.close();
    for (const key of Object.keys(globals)) delete (globalThis as Record<string, unknown>)[key];
  }
});
