# Changelog

All notable changes to `@yawlabs/lemonsqueezy-webhook-sink` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.1] -- 2026-05-15

Hardening pass before active use. No breaking changes to the happy-path HTTP contract; behavior changes are limited to error responses on previously-loose input.

### Added

- **1 MB body-size limit on `POST /webhook`** via Hono's `bodyLimit` middleware. Oversized bodies return 413 before the HMAC is computed -- attackers can't make the sink buffer arbitrary payloads.
- **`/healthz` now pings the DB** via a cached `SELECT 1` prepared statement. Returns 503 if the handle is unhealthy instead of falsely reporting OK.
- **PORT validation** at startup -- the process refuses to boot with a non-integer or out-of-range port rather than silently binding to NaN.
- **Bounded shutdown timeout** (10s force-exit fallback) so a stuck connection during `SIGTERM`/`SIGINT` no longer hangs the process indefinitely.
- **`ls_sink_*` MCP tool bridge.** The companion [@yawlabs/lemonsqueezy-mcp](https://github.com/YawLabs/lemonsqueezy-mcp) 0.10.0 ships `ls_sink_events_list`, `ls_sink_event_mark_processed`, and `ls_sink_stats` that talk to this sink over HTTP using `LEMONSQUEEZY_SINK_URL` + `LEMONSQUEEZY_SINK_ADMIN_TOKEN`.
- Tests covering the new 413 / 503 / 400-on-bad-since-or-limit paths, the timing-safe-compare same-length branch, the admin-disabled body-leak check, and the `EventStore.ping()` happy/closed cases.

### Changed

- **Admin bearer check is now timing-safe.** `timingSafeEqual` on equal-length byte buffers; falls through to 401 on length mismatch. Matches the discipline already used in `verify.ts` for the HMAC compare.
- **Admin-disabled response is now a plain `404 Not Found`** with no informative body. Previously returned `{"error":"admin endpoints disabled"}`, which leaked the fact that an admin surface exists. Indistinguishable from any unknown route to an unauthenticated caller.
- **`GET /events` rejects non-finite or negative `since`/`limit` with 400** and a JSON error body. Previously silently returned an empty result for `?since=abc` etc., which made the failure mode invisible to consumers with a typo.
- **`EventStore` prepared statements are cached on the instance** rather than re-prepared on every call. Reduces GC pressure under sustained load.
- **`release.sh` now creates annotated tags** (`git tag -a -m`) and pushes with `--follow-tags` instead of `--tags`. Matches the YawLabs annotated-tag rule -- lightweight tags would be silently skipped by `--follow-tags`.

### Fixed

- **`schema.sql` header comment** corrected to describe the actual dedupe key (`event_id` alone when present, else SHA-256 hash of `event_name | data.type | data.id | data.attributes.created_at`). Previously said "event_name + custom_data.event_id" which didn't match the handler.
- **`README.md`** now lists the full response-code matrix for `POST /webhook` (200/400/401/413) and notes that the admin endpoints return 404 indistinguishably from unknown routes when no token is configured.

## [0.1.0] -- 2026-04-20

Initial release.

### Added

- **HMAC signature verification** (`src/verify.ts`) using `createHmac("sha256", ...)` + `timingSafeEqual`. Length-checks before comparing to avoid leaking info to mismatched signatures of different length.
- **SQLite event store** (`src/store.ts`) with WAL mode. `event_key UNIQUE` constraint makes `insert()` an atomic dedupe -- duplicate deliveries return the existing `id` with `duplicate: true` and do not write.
- **Stable dedupe key** (`src/handler.ts`). Prefers `meta.custom_data.event_id` when the sender provides one; otherwise SHA-256 of `event_name | data.type | data.id | data.attributes.created_at`, which is stable across LemonSqueezy's "same event retried" deliveries because the payload doesn't change between retries.
- **HTTP endpoints** via Hono (`src/app.ts` + `src/index.ts`):
  - `POST /webhook` -- HMAC-verified ingress. Always returns 200 for both new and duplicate events so LemonSqueezy doesn't needlessly retry a duplicate.
  - `GET /healthz` -- liveness.
  - `GET /events?since=<ts>&type=<name>&limit=<n>` -- pull interface for consumers. Admin-token gated.
  - `POST /events/:id/processed` -- mark an event consumed. Admin-token gated.
  - `GET /stats` -- totals for monitoring. Admin-token gated.
- **Safe admin default.** When `WEBHOOK_SINK_ADMIN_TOKEN` is unset, the admin endpoints return 404 rather than being exposed unauthenticated.
- **Graceful shutdown** on `SIGTERM`/`SIGINT` -- closes the HTTP server and the SQLite handle.
- **`createApp({ store, signingSecret, adminToken })` factory** (`src/app.ts`), extracted from `src/index.ts` so the Hono app can be constructed in tests without starting a real HTTP server.
- End-to-end HTTP tests in `src/app.test.ts` exercising every endpoint via `app.fetch()`.
- Release pipeline (`.github/workflows/release.yml` + `release.sh`) -- tag `vX.Y.Z` to publish via the org-level `NPM_TOKEN` secret.
- CI across Node 20 and 22. Biome lint, TypeScript strict, `node --test`.

[0.1.1]: https://github.com/YawLabs/lemonsqueezy-webhook-sink/releases/tag/v0.1.1
[0.1.0]: https://github.com/YawLabs/lemonsqueezy-webhook-sink/releases/tag/v0.1.0
