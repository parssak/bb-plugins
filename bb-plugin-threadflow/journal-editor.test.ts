import assert from "node:assert/strict";
import test from "node:test";

import { isLikelyMermaid, mermaidPreviewMarkdown } from "./journal-mermaid.ts";

test("recognizes Mermaid syntax without treating ordinary code as a diagram", () => {
  assert.equal(isLikelyMermaid("flowchart TD\n  A --> B"), true);
  assert.equal(isLikelyMermaid("%% comment\nsequenceDiagram\n  A->>B: hello"), true);
  assert.equal(isLikelyMermaid("const graph = new Map()"), false);
});

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
