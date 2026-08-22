import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AlertStore } from "../src/alert-store.js";

test("a recorded chain and token address is recognized as alerted", (t) => {
  const store = new AlertStore(":memory:");
  t.after(() => store.close());

  assert.equal(store.hasAlert(8453, "0xAbCd"), false);

  store.recordAlert(8453, "0xAbCd");

  assert.equal(store.hasAlert(8453, "0xabcd"), true);
});

test("the same address on a different chain is a separate alert", (t) => {
  const store = new AlertStore(":memory:");
  t.after(() => store.close());

  store.recordAlert(8453, "0xabcd");

  assert.equal(store.hasAlert(143, "0xabcd"), false);
});

test("a file-backed store creates its parent directory", (t) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "o1-alert-store-"));
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

  const store = new AlertStore(join(temporaryDirectory, "nested", "alerts.sqlite"));
  t.after(() => store.close());

  store.recordAlert(8453, "0xabcd");
  assert.equal(store.hasAlert(8453, "0xabcd"), true);
});
