#!/usr/bin/env node

import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { parsePort, requireEnv } from "./env.js";
import { installShutdown } from "./shutdown.js";
import { EventStore } from "./store.js";

const SIGNING_SECRET = requireEnv("LEMONSQUEEZY_SIGNING_SECRET");
const DB_PATH = process.env.WEBHOOK_SINK_DB ?? "./events.db";
const PORT = parsePort(process.env.PORT ?? "8787");
const ADMIN_TOKEN = process.env.WEBHOOK_SINK_ADMIN_TOKEN;

const store = new EventStore(DB_PATH);
const app = createApp({ store, signingSecret: SIGNING_SECRET, adminToken: ADMIN_TOKEN });

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`lemonsqueezy-webhook-sink listening on :${info.port}`);
});

const { shutdown } = installShutdown({ server, store });
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
