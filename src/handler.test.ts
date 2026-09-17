import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { deriveEventKey, handleWebhook } from "./handler.js";
import { EventStore } from "./store.js";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("deriveEventKey", () => {
  it("prefers meta.custom_data.event_id when present", () => {
    const key = deriveEventKey({
      meta: { event_name: "order_created", custom_data: { event_id: "evt_123" } },
      data: { id: "1" },
    });
    assert.equal(key, "evt_123");
  });

  it("falls back to a stable hash when event_id is absent", () => {
    const payload = {
      meta: { event_name: "order_created" },
      data: { id: "1", type: "orders", attributes: { created_at: "2026-01-01T00:00:00Z" } },
    };
    const a = deriveEventKey(payload);
    const b = deriveEventKey(payload);
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  it("produces different hashes for different resources", () => {
    const base = {
      meta: { event_name: "order_created" },
      data: { type: "orders", attributes: { created_at: "2026-01-01T00:00:00Z" } },
    };
    const a = deriveEventKey({ ...base, data: { ...base.data, id: "1" } });
    const b = deriveEventKey({ ...base, data: { ...base.data, id: "2" } });
    assert.notEqual(a, b);
  });
});

describe("handleWebhook", () => {
  const secret = "whsec_test";
  let store: EventStore;
  let dbPath: string;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-sink-"));
    dbPath = path.join(dir, "events.db");
    store = new EventStore(dbPath);
  });

  afterEach(() => {
    store.close();
    try {
      fs.unlinkSync(dbPath);
    } catch {}
  });

  function validBody(eventName = "order_created", id = "42") {
    return JSON.stringify({
      meta: { event_name: eventName },
      data: { type: "orders", id, attributes: { created_at: "2026-01-01T00:00:00Z" } },
    });
  }

  it("persists a valid webhook and returns 200", () => {
    const body = validBody();
    const result = handleWebhook({ store, signingSecret: secret }, { rawBody: body, signature: sign(body, secret) });
    assert.equal(result.status, 200);
    assert.equal((result.body as { ok: true; duplicate: boolean }).duplicate, false);
  });

  it("dedupes identical webhook deliveries", () => {
    const body = validBody();
    const sig = sign(body, secret);
    const first = handleWebhook({ store, signingSecret: secret }, { rawBody: body, signature: sig });
    const second = handleWebhook({ store, signingSecret: secret }, { rawBody: body, signature: sig });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((second.body as { ok: true; duplicate: boolean }).duplicate, true);
    assert.equal(store.stats().total, 1);
  });

  it("rejects invalid signature with 401", () => {
    const body = validBody();
    const result = handleWebhook({ store, signingSecret: secret }, { rawBody: body, signature: "deadbeef" });
    assert.equal(result.status, 401);
    assert.equal(store.stats().total, 0);
  });

  it("rejects missing signature with 401", () => {
    const body = validBody();
    const result = handleWebhook({ store, signingSecret: secret }, { rawBody: body, signature: null });
    assert.equal(result.status, 401);
  });

  it("rejects malformed JSON with 400 after sig passes", () => {
    const body = "not json";
    const result = handleWebhook({ store, signingSecret: secret }, { rawBody: body, signature: sign(body, secret) });
    assert.equal(result.status, 400);
    assert.match((result.body as { error: string }).error, /invalid json/);
  });

  it("rejects payload missing meta.event_name with 400", () => {
    const body = JSON.stringify({ data: { id: "1" } });
    const result = handleWebhook({ store, signingSecret: secret }, { rawBody: body, signature: sign(body, secret) });
    assert.equal(result.status, 400);
    assert.match((result.body as { error: string }).error, /missing meta.event_name/);
  });

  it("stores raw body verbatim for re-verification", () => {
    const body = validBody();
    handleWebhook({ store, signingSecret: secret }, { rawBody: body, signature: sign(body, secret) });
    const rows = store.list({ limit: 1 });
    assert.equal(rows[0]?.payload, body);
  });

  it("accepts a numeric data.id and stores it as a string resource_id", () => {
    const body = JSON.stringify({
      meta: { event_name: "order_created" },
      data: { type: "orders", id: 42, attributes: { created_at: "2026-01-01T00:00:00Z" } },
    });
    const result = handleWebhook({ store, signingSecret: secret }, { rawBody: body, signature: sign(body, secret) });
    assert.equal(result.status, 200);
    assert.equal(store.list({})[0]?.resource_id, "42");
  });

  it("stores resource_id as null when data.id is absent", () => {
    const body = JSON.stringify({
      meta: { event_name: "order_created" },
      data: { type: "orders", attributes: { created_at: "2026-01-01T00:00:00Z" } },
    });
    const result = handleWebhook({ store, signingSecret: secret }, { rawBody: body, signature: sign(body, secret) });
    assert.equal(result.status, 200);
    assert.equal(store.list({})[0]?.resource_id, null);
  });

  it("rejects an empty body with 400 invalid json (after sig passes)", () => {
    const rawBody = "";
    const signature = createHmac("sha256", secret).update("").digest("hex");
    const result = handleWebhook({ store, signingSecret: secret }, { rawBody, signature });
    assert.equal(result.status, 400);
    assert.match((result.body as { error: string }).error, /invalid json/);
  });
});
