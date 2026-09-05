import assert from "node:assert/strict";
import test from "node:test";

import { parseThreadTitleBrand } from "./thread-title-brand.ts";

test("recognized title prefixes become brand metadata", () => {
  assert.deepEqual(parseThreadTitleBrand("[bb] Build the release"), {
    brand: "bb",
    title: "Build the release",
  });
  assert.deepEqual(parseThreadTitleBrand("[BOGI]Check the campaign"), {
    brand: "bogi",
    title: "Check the campaign",
  });
});

test("unknown and non-leading tags remain part of the title", () => {
  assert.deepEqual(parseThreadTitleBrand("[other] Keep this"), {
    brand: null,
    title: "[other] Keep this",
  });
  assert.deepEqual(parseThreadTitleBrand("Review [bb] work"), {
    brand: null,
    title: "Review [bb] work",
  });
});
