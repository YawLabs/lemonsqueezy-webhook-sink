#!/usr/bin/env node

import { serve } from "@hono/node-server";
import { type Context, Hono } from "hono";
import { handleWebhook } from "./handler.js";
import { EventStore } from "./store.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`${name} environment variable is required`);
  return v;
}

const SIGNING_SECRET = requireEnv("LEMONSQUEEZY_SIGNING_SECRET");
const DB_PATH = process.env.WEBHOOK_SINK_DB ?? "./events.db";
const PORT = Number(process.env.PORT ?? 8787);
const ADMIN_TOKEN = process.env.WEBHOOK_SINK_ADMIN_TOKEN;

const store = new EventStore(DB_PATH);
const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

app.post("/webhook", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-signature") ?? null;
  const result = handleWebhook({ store, signingSecret: SIGNING_SECRET }, { rawBody, signature });
  return c.json(result.body, result.status);
});

// Admin endpoints are guarded by a bearer token. If WEBHOOK_SINK_ADMIN_TOKEN is
// unset, they are disabled entirely — safer default than "unprotected".
function requireAdmin(c: Context): Response | null {
  if (!ADMIN_TOKEN) return c.json({ error: "admin endpoints disabled" }, 404);
  const auth = c.req.header("authorization") ?? "";
  if (auth !== `Bearer ${ADMIN_TOKEN}`) return c.json({ error: "unauthorized" }, 401);
  return null;
}

app.get("/events", (c) => {
  const unauthorized = requireAdmin(c);
  if (unauthorized) return unauthorized;
  const since = Number(c.req.query("since") ?? 0);
  const type = c.req.query("type") ?? undefined;
  const limit = Number(c.req.query("limit") ?? 100);
  const rows = store.list({ since, type, limit });
  return c.json({ events: rows });
});

app.post("/events/:id/processed", (c) => {
  const unauthorized = requireAdmin(c);
  if (unauthorized) return unauthorized;
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
  store.markProcessed(id);
  return c.json({ ok: true });
});

app.get("/stats", (c) => {
  const unauthorized = requireAdmin(c);
  if (unauthorized) return unauthorized;
  return c.json(store.stats());
});

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`lemonsqueezy-webhook-sink listening on :${info.port}`);
});

const shutdown = () => {
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
