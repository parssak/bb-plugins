import assert from "node:assert/strict";
import test from "node:test";
import { Editor } from "@tiptap/core";

import { journalMarkdownExtensions } from "./journal-markdown.ts";

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
