import assert from "node:assert/strict";
import test from "node:test";

import {
  parseThreadReferenceDrag,
  parseThreadReferenceHref,
  serializeThreadReferenceDrag,
  threadReferenceHref,
  threadReferenceMarkdown,
} from "./thread-reference.ts";

test("round-trips a Threadflow thread reference", () => {
  const reference = { id: "thr_abc-123", title: "Fix the header" };
  assert.deepEqual(parseThreadReferenceDrag(serializeThreadReferenceDrag(reference)), reference);
  assert.equal(parseThreadReferenceHref(threadReferenceHref(reference.id)), reference.id);
  assert.equal(
    threadReferenceMarkdown({ id: reference.id, title: "Fix [the] header" }),
    "[Fix \\[the\\] header](threadflow://thread/thr_abc-123)",
  );
});

test("rejects malformed thread references", () => {
  assert.equal(parseThreadReferenceDrag('{"id":"../bad","title":"No"}'), null);
  assert.equal(parseThreadReferenceDrag('{"id":"thr_ok","title":""}'), null);
  assert.equal(parseThreadReferenceHref("https://example.com/thread/thr_ok"), null);
  assert.equal(parseThreadReferenceHref("threadflow://thread/%2Fbad"), null);
});
