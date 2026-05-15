# Changelog

All notable changes to `@yawlabs/lemonsqueezy-webhook-sink` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] -- 2026-05-15

Initial release.

### Added

- **HMAC signature verification** (`src/verify.ts`) using `createHmac("sha256", ...)` + `timingSafeEqual`. Length-checks before comparing to avoid leaking info to mismatched signatures of different length.
- **SQLite event store** (`src/store.ts`) with WAL mode. `event_key UNIQUE` constraint makes `insert()` an atomic dedupe -- duplicate deliveries return the existing `id` with `duplicate: true` and do not write. Prepared statements are cached on the instance.
- **Stable dedupe key** (`src/handler.ts`). Prefers `meta.custom_data.event_id` when the sender provides one; otherwise SHA-256 of `event_name | data.type | data.id | data.attributes.created_at`, which is stable across LemonSqueezy's "same event retried" deliveries because the payload doesn't change between retries.
- **HTTP endpoints** via Hono (`src/app.ts` + `src/index.ts`):
  - `POST /webhook` -- HMAC-verified ingress. Returns 200 for new/duplicate, 400 for malformed payload, 401 for invalid signature, 413 for bodies >1 MB.
  - `GET /healthz` -- liveness. Pings the DB; returns 503 if the handle is unhealthy.
  - `GET /events?since=<ts>&type=<name>&limit=<n>` -- pull interface for consumers. Admin-token gated. Rejects non-finite or negative `since`/`limit` with 400.
  - `POST /events/:id/processed` -- mark an event consumed. Admin-token gated.
  - `GET /stats` -- totals for monitoring. Admin-token gated.
- **Body-size limit on `/webhook`** (1 MB) via Hono's `bodyLimit` middleware. Oversized bodies return 413 before the signature is even computed.
- **Timing-safe admin bearer check.** `timingSafeEqual` on equal-length byte buffers; falls through to 401 on length mismatch.
- **Safe admin default.** When `WEBHOOK_SINK_ADMIN_TOKEN` is unset, the admin endpoints respond `404 Not Found` indistinguishably from any unknown route -- the response body does not reveal that an admin surface exists.
- **Graceful shutdown** on `SIGTERM`/`SIGINT` -- closes the HTTP server and the SQLite handle, with a 10s force-exit fallback so a stuck connection doesn't block exit.
- **PORT validation** at startup -- the process refuses to boot with a non-integer or out-of-range port rather than silently binding to NaN.
- **`createApp({ store, signingSecret, adminToken })` factory** (`src/app.ts`), extracted from `src/index.ts` so the Hono app can be constructed in tests without starting a real HTTP server.
- End-to-end HTTP tests in `src/app.test.ts` exercising every endpoint via `app.fetch()`: signed webhook accept, dedupe, bad-signature 401, admin bearer-token gating, admin-disabled 404 (with body-leak check), `since`/`limit` validation, oversized-body 413, healthz when DB is closed, timing-safe-compare branch.
- Release pipeline (`.github/workflows/release.yml` + `release.sh`) -- tag `vX.Y.Z` to publish via the org-level `NPM_TOKEN` secret. Tags are annotated so `git push --follow-tags` propagates them.
- CI across Node 20 and 22. Biome lint, TypeScript strict, `node --test`.

[0.1.0]: https://github.com/YawLabs/lemonsqueezy-webhook-sink/releases/tag/v0.1.0
