import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Hono } from "hono";
import { createApp } from "./app.js";
import { EventStore } from "./store.js";

const SECRET = "whsec_test";
const ADMIN = "admin_token_xyz";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

function payload(eventName = "order_created", id = "42") {
  return JSON.stringify({
    meta: { event_name: eventName },
    data: { type: "orders", id, attributes: { created_at: "2026-01-01T00:00:00Z" } },
  });
}

describe("HTTP app", () => {
  let store: EventStore;
  let dbPath: string;
  let app: Hono;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-sink-http-"));
    dbPath = path.join(dir, "events.db");
    store = new EventStore(dbPath);
    app = createApp({ store, signingSecret: SECRET, adminToken: ADMIN });
  });

  afterEach(() => {
    store.close();
    try {
      fs.unlinkSync(dbPath);
    } catch {}
  });

  async function req(path: string, init: RequestInit = {}): Promise<Response> {
    return app.fetch(new Request(`http://test${path}`, init));
  }

  it("GET /healthz returns ok", async () => {
    const r = await req("/healthz");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  });

  it("POST /webhook accepts a signed body", async () => {
    const body = payload();
    const r = await req("/webhook", {
      method: "POST",
      headers: { "x-signature": sign(body), "content-type": "application/json" },
      body,
    });
    assert.equal(r.status, 200);
    const j = (await r.json()) as { ok: true; duplicate: boolean; id: number };
    assert.equal(j.ok, true);
    assert.equal(j.duplicate, false);
    assert.ok(j.id > 0);
  });

  it("POST /webhook dedupes repeat deliveries", async () => {
    const body = payload();
    const sig = sign(body);
    const headers = { "x-signature": sig, "content-type": "application/json" };
    await req("/webhook", { method: "POST", headers, body });
    const second = await req("/webhook", { method: "POST", headers, body });
    assert.equal(second.status, 200);
    const j = (await second.json()) as { ok: true; duplicate: boolean };
    assert.equal(j.duplicate, true);
    assert.equal(store.stats().total, 1);
  });

  it("POST /webhook rejects bad signature with 401", async () => {
    const body = payload();
    const r = await req("/webhook", {
      method: "POST",
      headers: { "x-signature": "deadbeef" },
      body,
    });
    assert.equal(r.status, 401);
    assert.equal(store.stats().total, 0);
  });

  it("GET /events requires bearer token", async () => {
    const r = await req("/events");
    assert.equal(r.status, 401);
  });

  it("GET /events returns stored events when authorized", async () => {
    const body = payload();
    await req("/webhook", {
      method: "POST",
      headers: { "x-signature": sign(body) },
      body,
    });
    const r = await req("/events", { headers: { authorization: `Bearer ${ADMIN}` } });
    assert.equal(r.status, 200);
    const data = (await r.json()) as { events: Array<{ event_name: string }> };
    assert.equal(data.events.length, 1);
    assert.equal(data.events[0]?.event_name, "order_created");
  });

  it("GET /events filters by since and type", async () => {
    for (const [name, id, _at] of [
      ["order_created", "1", 1],
      ["subscription_updated", "2", 2],
      ["order_created", "3", 3],
    ] as const) {
      const body = payload(name, id);
      await req("/webhook", {
        method: "POST",
        headers: { "x-signature": sign(body) },
        body,
      });
    }
    const r = await req("/events?type=order_created", {
      headers: { authorization: `Bearer ${ADMIN}` },
    });
    const data = (await r.json()) as { events: Array<{ resource_id: string }> };
    assert.equal(data.events.length, 2);
  });

  it("POST /events/:id/processed flips the flag", async () => {
    const body = payload();
    await req("/webhook", {
      method: "POST",
      headers: { "x-signature": sign(body) },
      body,
    });
    const id = store.list({})[0]?.id;
    assert.ok(id);
    const r = await req(`/events/${id}/processed`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN}` },
    });
    assert.equal(r.status, 200);
    assert.equal(store.stats().unprocessed, 0);
  });

  it("POST /events/:id/processed rejects non-numeric id with 400", async () => {
    const r = await req("/events/not-a-number/processed", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN}` },
    });
    assert.equal(r.status, 400);
  });

  it("GET /stats returns totals", async () => {
    const body = payload();
    await req("/webhook", {
      method: "POST",
      headers: { "x-signature": sign(body) },
      body,
    });
    const r = await req("/stats", { headers: { authorization: `Bearer ${ADMIN}` } });
    assert.equal(r.status, 200);
    const s = (await r.json()) as { total: number; unprocessed: number };
    assert.equal(s.total, 1);
    assert.equal(s.unprocessed, 1);
  });

  it("admin endpoints return 404 when token is unset", async () => {
    const noAuthApp = createApp({ store, signingSecret: SECRET, adminToken: undefined });
    const r = await noAuthApp.fetch(
      new Request("http://test/events", { headers: { authorization: "Bearer anything" } }),
    );
    assert.equal(r.status, 404);
  });

  it("admin endpoints reject wrong bearer token with 401", async () => {
    const r = await req("/stats", { headers: { authorization: "Bearer wrong" } });
    assert.equal(r.status, 401);
  });
});
