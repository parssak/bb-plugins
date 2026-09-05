import assert from "node:assert/strict";
import test from "node:test";

import {
  isThreadNudgerMessageText,
  isThreadNudgerUserMessage,
} from "./thread-nudger-message.ts";

test("recognizes historical Thread Nudger steers", () => {
  assert.equal(isThreadNudgerUserMessage({
    role: "user",
    text: "how's it going",
    turnRequest: { kind: "steer" },
  }), true);
  assert.equal(isThreadNudgerUserMessage({
    role: "user",
    text: "status update? don't stop if you're not done",
    turnRequest: { kind: "steer" },
  }), true);
});

test("does not hide a matching phrase sent as a genuine new message", () => {
  assert.equal(isThreadNudgerUserMessage({
    role: "user",
    text: "how's it going",
    turnRequest: { kind: "message" },
  }), false);
  assert.equal(isThreadNudgerMessageText("something else"), false);
});
