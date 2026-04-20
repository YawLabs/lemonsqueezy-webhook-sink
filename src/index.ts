#!/usr/bin/env node

import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
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
const app = createApp({ store, signingSecret: SIGNING_SECRET, adminToken: ADMIN_TOKEN });

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
