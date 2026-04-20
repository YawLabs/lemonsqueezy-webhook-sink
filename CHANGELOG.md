# Changelog

All notable changes to `@yawlabs/lemonsqueezy-webhook-sink` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- End-to-end HTTP tests in `src/app.test.ts` exercising every endpoint via `app.fetch()`: signed webhook accept, dedupe, bad-signature 401, admin bearer-token gating, admin-disabled 404, filter params, `/events/:id/processed` happy path and invalid-id 400.
- `src/app.ts` — `createApp({ store, signingSecret, adminToken })` factory, extracted from `src/index.ts` so the Hono app can be constructed in tests without starting a real HTTP server.
- Release pipeline (`.github/workflows/release.yml` + `release.sh`) — tag `vX.Y.Z` to publish via the org-level `NPM_TOKEN` secret.

## [0.1.0] — 2026-04-20

Initial scaffold. Not yet published to npm.

### Added

- **HMAC signature verification** (`src/verify.ts`) using `createHmac("sha256", ...)` + `timingSafeEqual`. Length-checks before comparing to avoid leaking info to mismatched signatures of different length.
- **SQLite event store** (`src/store.ts`) with WAL mode. `event_key UNIQUE` constraint makes `insert()` an atomic dedupe — duplicate deliveries return the existing `id` with `duplicate: true` and do not write.
- **Stable dedupe key** (`src/handler.ts`). Prefers `meta.custom_data.event_id` when the sender provides one; otherwise SHA-256 of `event_name | data.type | data.id | data.attributes.created_at`, which is stable across LemonSqueezy's "same event retried" deliveries because the payload doesn't change between retries.
- **HTTP endpoints** (`src/index.ts`) via Hono:
  - `POST /webhook` — HMAC-verified ingress. Always returns 200 for both new and duplicate events so LemonSqueezy doesn't needlessly retry a duplicate.
  - `GET /healthz` — liveness.
  - `GET /events?since=<ts>&type=<name>&limit=<n>` — pull interface for consumers. Admin-token gated.
  - `POST /events/:id/processed` — mark an event consumed. Admin-token gated.
  - `GET /stats` — totals for monitoring. Admin-token gated.
- **Safe admin default.** When `WEBHOOK_SINK_ADMIN_TOKEN` is unset, the `/events`, `/events/:id/processed`, and `/stats` endpoints return 404 rather than being exposed unauthenticated. Opt in by setting the bearer token.
- **Graceful shutdown** on `SIGTERM`/`SIGINT` — closes the HTTP server and the SQLite handle.
- CI across Node 20 and 22. Biome lint, TypeScript strict, `node --test`.

[Unreleased]: https://github.com/YawLabs/lemonsqueezy-webhook-sink/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/YawLabs/lemonsqueezy-webhook-sink/releases/tag/v0.1.0
