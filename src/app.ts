import { type Context, Hono } from "hono";
import { handleWebhook } from "./handler.js";
import type { EventStore } from "./store.js";

export interface AppConfig {
  store: EventStore;
  signingSecret: string;
  adminToken: string | undefined;
}

export function createApp(config: AppConfig): Hono {
  const { store, signingSecret, adminToken } = config;
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.post("/webhook", async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header("x-signature") ?? null;
    const result = handleWebhook({ store, signingSecret }, { rawBody, signature });
    return c.json(result.body, result.status);
  });

  function requireAdmin(c: Context): Response | null {
    if (!adminToken) return c.json({ error: "admin endpoints disabled" }, 404);
    const auth = c.req.header("authorization") ?? "";
    if (auth !== `Bearer ${adminToken}`) return c.json({ error: "unauthorized" }, 401);
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

  return app;
}
