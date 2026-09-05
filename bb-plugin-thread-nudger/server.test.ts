import assert from "node:assert/strict";
import test from "node:test";

import { createThreadNudgeInput } from "./server.ts";

test("Thread Nudger messages stay out of user-visible chat history", () => {
  assert.deepEqual(createThreadNudgeInput("how's it going"), {
    type: "text",
    text: "how's it going",
    mentions: [],
    visibility: "agent-only",
  });
});
