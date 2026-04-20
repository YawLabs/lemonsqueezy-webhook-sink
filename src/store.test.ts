import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { EventStore } from "./store.js";

describe("EventStore", () => {
  let store: EventStore;
  let dbPath: string;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-sink-store-"));
    dbPath = path.join(dir, "events.db");
    store = new EventStore(dbPath);
  });

  afterEach(() => {
    store.close();
    try {
      fs.unlinkSync(dbPath);
    } catch {}
  });

  function base(overrides: Partial<Parameters<EventStore["insert"]>[0]> = {}) {
    return {
      event_key: "evt_1",
      event_name: "order_created",
      resource_id: "42",
      received_at: 1000,
      payload: "{}",
      ...overrides,
    };
  }

  it("insert returns a new id and duplicate=false", () => {
    const r = store.insert(base());
    assert.ok(r.id > 0);
    assert.equal(r.duplicate, false);
  });

  it("insert with existing event_key returns duplicate=true and same id", () => {
    const r1 = store.insert(base());
    const r2 = store.insert(base({ payload: '{"different":true}' }));
    assert.equal(r2.id, r1.id);
    assert.equal(r2.duplicate, true);
    assert.equal(store.stats().total, 1);
  });

  it("list filters by received_at exclusively", () => {
    store.insert(base({ event_key: "a", received_at: 100 }));
    store.insert(base({ event_key: "b", received_at: 200 }));
    store.insert(base({ event_key: "c", received_at: 300 }));
    const rows = store.list({ since: 100 });
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => r.event_key),
      ["b", "c"],
    );
  });

  it("list filters by event_name", () => {
    store.insert(base({ event_key: "a", event_name: "order_created", received_at: 1 }));
    store.insert(base({ event_key: "b", event_name: "subscription_updated", received_at: 2 }));
    const rows = store.list({ type: "subscription_updated" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.event_key, "b");
  });

  it("list limit is clamped between 1 and 1000", () => {
    for (let i = 0; i < 5; i++) store.insert(base({ event_key: `k${i}`, received_at: i + 1 }));
    assert.equal(store.list({ limit: -5 }).length, 1);
    assert.equal(store.list({ limit: 9999 }).length, 5);
  });

  it("markProcessed flips the flag", () => {
    const { id } = store.insert(base());
    assert.equal(store.stats().unprocessed, 1);
    store.markProcessed(id);
    assert.equal(store.stats().unprocessed, 0);
  });

  it("stats reports last received_at", () => {
    store.insert(base({ event_key: "a", received_at: 500 }));
    store.insert(base({ event_key: "b", received_at: 700 }));
    assert.equal(store.stats().lastReceivedAt, 700);
  });
});
