import assert from "node:assert/strict";
import test from "node:test";

import { mermaidPreviewMarkdown } from "./journal-mermaid.ts";

test("wraps Mermaid source in a fence that cannot terminate early", () => {
  assert.equal(
    mermaidPreviewMarkdown("flowchart TD\n  A --> B"),
    "```mermaid\nflowchart TD\n  A --> B\n```",
  );
  assert.equal(
    mermaidPreviewMarkdown("flowchart TD\n  A[```] --> B"),
    "````mermaid\nflowchart TD\n  A[```] --> B\n````",
  );
});
