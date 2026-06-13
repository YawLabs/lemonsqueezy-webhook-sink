# Changelog

All notable changes to `@yawlabs/lemonsqueezy-webhook-sink` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.6] -- 2026-06-13

Dependency maintenance. The published change is the `@hono/node-server` major bump; the server was boot-tested under it.

### Changed

- **`@hono/node-server` bumped 1.19.14 -> 2.0.4 (major).** This is the HTTP adapter `src/index.ts` boots via `serve()`. Verified the server starts and `GET /healthz` returns 200 under 2.x. `hono` (4.12.25) and `better-sqlite3` (12.10.0) also moved up by patch; dev tooling (`@biomejs/biome` 2.5.0, `@types/node` 25.9.3) by minor.

### Fixed

- **`.gitignore` now ignores SQLite WAL sidecars** (`*.db-shm`, `*.db-wal`). The store runs in WAL mode, so running the app left two untracked files the prior `*.db` / `*.db-journal` patterns missed.

## [0.1.5] -- 2026-06-13

Maintenance. The only change to the published package is the Node engine floor; the rest is repo hygiene.

### Changed

- **`engines.node` raised from `>=20` to `>=22`.** Node 20 reached end-of-life, so the supported floor moves up to the current active LTS.

### Removed

- Stale leftovers from the 0.1.2 move to a local-only release flow (none are in the published package): the orphaned Dependabot `github-actions` updater, the dead CI-handoff branch in `release.sh`, and the unused `test:ci` npm script.

## [0.1.4] -- 2026-06-13

Dependency maintenance. No changes to the runtime HTTP contract or behavior -- every bump type-checks clean and passes the full test suite.

### Changed

- **Runtime dependencies bumped:** `hono` 4.12.14 -> 4.12.23 (patch) and `better-sqlite3` 11.10.0 -> 12.9.0 (major; API-compatible for the prepared-statement and `pragma`/`exec` surface this package uses).
- **Dev/build toolchain bumped:** `typescript` 5.9.3 -> 6.0.3, `@types/node` 22.19.17 -> 25.6.0, and `@biomejs/biome` 1.9.4 -> 2.4.13. The Biome 2.x bump required migrating `biome.json` to the 2.x schema (top-level `organizeImports` moved under `assist.actions.source`).

### Fixed

- **Line endings normalized via `.gitattributes`** (`* text=auto eol=lf`). Files now check out as LF regardless of `core.autocrlf`; previously Biome (which expects LF) flagged formatting on files Git had rewritten with CRLF on Windows checkouts.

## [0.1.3] -- 2026-06-02

Testability refactor plus release-script hardening. No runtime behavior change.

### Added

- **Unit tests for the boot-time env validators** (`parsePort`, `requireEnv`) -- port range/format rejection and required/blank-value handling.

### Changed

- **`parsePort` and `requireEnv` extracted into `src/env.ts`** from `index.ts`, so they can be unit-tested without triggering `index.ts`'s import-time side effects (reading env, opening the DB, starting the HTTP server, registering signal handlers).
- **`release.sh`: `SKIP_LINT=1` escape hatch** for the MINGW64-ARM64 `npm run` segfault, and the confirmation prompt is now TTY-gated so non-interactive runs proceed instead of hanging.

### Fixed

- **`release.sh` tag-drift guard.** The script refuses to push if origin already has the version tag pointing at a different commit (rewound tag / parallel-release race), rather than letting `git push --follow-tags` silently skip the tag and link a GitHub release to a stale commit. The guard compares dereferenced tag-object SHAs, so resuming an interrupted release no longer false-aborts.

## [0.1.2] -- 2026-05-28

Release-pipeline change: moved from GitHub Actions to a local-only release flow. No changes to the published package.

### Changed

- **Removed all GitHub Actions workflows** (`ci.yml`, `release.yml`, and unused siblings). Releases now run entirely from the workstation via `release.sh` -- lint, build, test, version bump, tag, npm publish, and GitHub release creation -- authenticated with a local npm automation token. CI-on-tag-push is no longer part of this repo's flow.

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

[0.1.6]: https://github.com/YawLabs/lemonsqueezy-webhook-sink/releases/tag/v0.1.6
[0.1.5]: https://github.com/YawLabs/lemonsqueezy-webhook-sink/releases/tag/v0.1.5
[0.1.4]: https://github.com/YawLabs/lemonsqueezy-webhook-sink/releases/tag/v0.1.4
[0.1.3]: https://github.com/YawLabs/lemonsqueezy-webhook-sink/releases/tag/v0.1.3
[0.1.2]: https://github.com/YawLabs/lemonsqueezy-webhook-sink/releases/tag/v0.1.2
[0.1.1]: https://github.com/YawLabs/lemonsqueezy-webhook-sink/releases/tag/v0.1.1
[0.1.0]: https://github.com/YawLabs/lemonsqueezy-webhook-sink/releases/tag/v0.1.0
