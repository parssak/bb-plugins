import assert from "node:assert/strict";
import test from "node:test";

import {
  collectUserMessageTimestamps,
  formatUserMessageTimestamp,
  type TimelineRowCandidate,
} from "./user-message-timestamp.ts";

function userRow(overrides: Partial<TimelineRowCandidate> = {}): TimelineRowCandidate {
  return {
    id: "message-1",
    createdAt: Date.UTC(2026, 8, 5, 19, 7),
    kind: "conversation",
    role: "user",
    initiator: "user",
    text: "A real message",
    turnRequest: { kind: "message" },
    ...overrides,
  };
}

test("collects genuine user messages and aliases nested messages to their turn row", () => {
  const messages = collectUserMessageTimestamps([
    {
      id: "turn-row-1",
      createdAt: 1,
      kind: "turn",
      children: [userRow()],
    },
  ]);

  assert.deepEqual(messages, [{
    rowIds: ["message-1", "turn-row-1"],
    createdAt: Date.UTC(2026, 8, 5, 19, 7),
  }]);
});

test("excludes nudger and agent-authored user-role messages", () => {
  assert.deepEqual(collectUserMessageTimestamps([
    userRow({ id: "nudger", text: "how's it going", turnRequest: { kind: "steer" } }),
    userRow({ id: "agent", initiator: "agent" }),
  ]), []);
});

test("formats a compact local date and time and includes the year only when needed", () => {
  const sameYearMessage = new Date(2026, 8, 5, 19, 7).getTime();
  const previousYearMessage = new Date(2025, 8, 5, 19, 7).getTime();
  const now = new Date(2026, 8, 6).getTime();
  assert.equal(
    formatUserMessageTimestamp(sameYearMessage, now, "en-US"),
    "Sep 5, 7:07 PM",
  );
  assert.equal(
    formatUserMessageTimestamp(previousYearMessage, now, "en-US"),
    "Sep 5, 2025, 7:07 PM",
  );
});
