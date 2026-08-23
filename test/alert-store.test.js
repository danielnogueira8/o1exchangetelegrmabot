import assert from "node:assert/strict";
import Database from "better-sqlite3";
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

test("a legacy alerted-token database migrates to claimed identities", (t) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "o1-alert-migration-"));
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));
  const filename = join(temporaryDirectory, "alerts.sqlite");
  const legacyDatabase = new Database(filename);
  legacyDatabase.exec(`
    CREATE TABLE alerted_tokens (
      chain_id INTEGER NOT NULL,
      token_address TEXT NOT NULL,
      alerted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (chain_id, token_address)
    );
    INSERT INTO alerted_tokens (chain_id, token_address)
    VALUES (8453, '0xabcd');
  `);
  legacyDatabase.close();

  const store = new AlertStore(filename);
  assert.equal(store.claimAlert(8453, "0xABCD"), false);
  store.close();

  const migratedDatabase = new Database(filename, { readonly: true });
  t.after(() => migratedDatabase.close());
  const migratedClaim = migratedDatabase
    .prepare("SELECT claimed_at FROM claimed_alerts WHERE chain_id = ? AND token_address = ?")
    .get(8453, "0xabcd");
  assert.ok(migratedClaim);
});
