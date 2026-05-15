import { timingSafeEqual } from "node:crypto";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { handleWebhook } from "./handler.js";
import type { EventStore } from "./store.js";

export interface AppConfig {
  store: EventStore;
  signingSecret: string;
  adminToken: string | undefined;
}

const MAX_WEBHOOK_BYTES = 1024 * 1024;

export function createApp(config: AppConfig): Hono {
  const { store, signingSecret, adminToken } = config;
  const app = new Hono();

  app.get("/healthz", (c) => {
    try {
      store.ping();
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  app.post(
    "/webhook",
    bodyLimit({
      maxSize: MAX_WEBHOOK_BYTES,
      onError: (c) => c.json({ ok: false, error: "payload too large" }, 413),
    }),
    async (c) => {
      const rawBody = await c.req.text();
      const signature = c.req.header("x-signature") ?? null;
      const result = handleWebhook({ store, signingSecret }, { rawBody, signature });
      return c.json(result.body, result.status);
    },
  );

  function requireAdmin(c: Context): Response | null {
    // Admin endpoints look identical to unknown routes when no token is configured -- avoids
    // confirming the endpoint exists to unauthenticated callers.
    if (!adminToken) return c.text("404 Not Found", 404);
    const auth = c.req.header("authorization") ?? "";
    const expected = `Bearer ${adminToken}`;
    const authBuf = Buffer.from(auth, "utf8");
    const expectedBuf = Buffer.from(expected, "utf8");
    if (authBuf.length !== expectedBuf.length) return c.json({ error: "unauthorized" }, 401);
    if (!timingSafeEqual(authBuf, expectedBuf)) return c.json({ error: "unauthorized" }, 401);
    return null;
  }

  app.get("/events", (c) => {
    const unauthorized = requireAdmin(c);
    if (unauthorized) return unauthorized;

    const sinceRaw = c.req.query("since");
    const since = sinceRaw === undefined ? 0 : Number(sinceRaw);
    if (!Number.isFinite(since) || since < 0) return c.json({ error: "invalid since" }, 400);

    const type = c.req.query("type") || undefined;

    const limitRaw = c.req.query("limit");
    const limit = limitRaw === undefined ? 100 : Number(limitRaw);
    if (!Number.isFinite(limit) || limit < 1) return c.json({ error: "invalid limit" }, 400);

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
