#!/usr/bin/env node

import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { EventStore } from "./store.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`${name} environment variable is required`);
  return v;
}

function parsePort(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`PORT must be an integer in [1, 65535], got: ${JSON.stringify(raw)}`);
  }
  return n;
}

const SHUTDOWN_TIMEOUT_MS = 10_000;

const SIGNING_SECRET = requireEnv("LEMONSQUEEZY_SIGNING_SECRET");
const DB_PATH = process.env.WEBHOOK_SINK_DB ?? "./events.db";
const PORT = parsePort(process.env.PORT ?? "8787");
const ADMIN_TOKEN = process.env.WEBHOOK_SINK_ADMIN_TOKEN;

const store = new EventStore(DB_PATH);
const app = createApp({ store, signingSecret: SIGNING_SECRET, adminToken: ADMIN_TOKEN });

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`lemonsqueezy-webhook-sink listening on :${info.port}`);
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  const forceExit = setTimeout(() => {
    console.error(`shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();
  server.close(() => {
    clearTimeout(forceExit);
    store.close();
    process.exit(0);
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
