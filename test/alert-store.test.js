import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AlertStore } from "../src/alert-store.js";

test("a chain and token address can only be claimed once", (t) => {
  const store = new AlertStore(":memory:");
  t.after(() => store.close());

  assert.equal(store.claimAlert(8453, "0xAbCd"), true);
  assert.equal(store.claimAlert(8453, "0xabcd"), false);
});

test("the same address on a different chain is a separate alert", (t) => {
  const store = new AlertStore(":memory:");
  t.after(() => store.close());

  assert.equal(store.claimAlert(8453, "0xabcd"), true);
  assert.equal(store.claimAlert(143, "0xabcd"), true);
});

test("a released preview can be claimed on a later live poll", (t) => {
  const store = new AlertStore(":memory:");
  t.after(() => store.close());

  assert.equal(store.claimAlert(8453, "0xabcd"), true);
  store.releaseAlert(8453, "0xabcd");
  assert.equal(store.claimAlert(8453, "0xabcd"), true);
});

test("a file-backed store creates its parent directory", (t) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "o1-alert-store-"));
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

  const store = new AlertStore(join(temporaryDirectory, "nested", "alerts.sqlite"));
  t.after(() => store.close());

  assert.equal(store.claimAlert(8453, "0xabcd"), true);
  assert.equal(store.claimAlert(8453, "0xabcd"), false);
});
