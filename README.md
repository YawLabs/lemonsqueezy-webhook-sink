# @yawlabs/lemonsqueezy-webhook-sink

Durable webhook receiver for [LemonSqueezy](https://lemonsqueezy.com). Verifies HMAC signatures, deduplicates repeat deliveries, and persists every event to SQLite so your downstream services can read from the sink on their own schedule and reconcile state even when their API calls succeed-but-the-response-is-lost.

Designed to sit **in front of** your business logic — not to replace it.

## Why this exists

API writes against LemonSqueezy can succeed upstream and fail to deliver a response to you (timeouts, network partitions, crashes mid-ack). The canonical way to recover is to subscribe to webhooks and reconcile your local state against what LemonSqueezy actually observed. This service is the durable sink for that reconciliation loop.

If you're running an agent or unattended automation against [@yawlabs/lemonsqueezy-mcp](https://github.com/YawLabs/lemonsqueezy-mcp), pair it with this sink.

## Quick start

```bash
npx @yawlabs/lemonsqueezy-webhook-sink
```

Required environment:

| Variable | Purpose |
| --- | --- |
| `LEMONSQUEEZY_SIGNING_SECRET` | The signing secret from your LemonSqueezy webhook config. Used to verify `X-Signature`. |

Optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | HTTP port to listen on. |
| `WEBHOOK_SINK_DB` | `./events.db` | Path to the SQLite file. |
| `WEBHOOK_SINK_ADMIN_TOKEN` | *(unset → admin disabled)* | Bearer token required to hit `/events`, `/events/:id/processed`, `/stats`. When unset, those endpoints return 404. |

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/webhook` | HMAC | Receive a LemonSqueezy webhook. Returns 200 for both new and duplicate events. |
| `GET` | `/healthz` | none | Liveness check. |
| `GET` | `/events?since=<ts>&type=<name>&limit=<n>` | `WEBHOOK_SINK_ADMIN_TOKEN` | Page events in order of `received_at`. Use `since=<last-seen-ts>` to checkpoint. |
| `POST` | `/events/:id/processed` | `WEBHOOK_SINK_ADMIN_TOKEN` | Mark an event consumed. |
| `GET` | `/stats` | `WEBHOOK_SINK_ADMIN_TOKEN` | Total events, unprocessed count, last-received timestamp. |

## Deduplication

Every event is stored under a stable `event_key`:

1. If the sender supplies `meta.custom_data.event_id` (e.g. you set one on checkout), that wins.
2. Otherwise, a SHA-256 of `event_name + data.type + data.id + data.attributes.created_at`. This is stable across LemonSqueezy's retries because the payload itself doesn't change between deliveries.

Duplicate deliveries return `200 { ok: true, duplicate: true }` and are not inserted a second time.

## Reconciliation pattern

```
# Your service pulls events and applies them.
last_seen = load_checkpoint()
while True:
    events = GET /events?since=${last_seen}&limit=100
    for e in events:
        apply(e.payload)
        POST /events/${e.id}/processed
        last_seen = e.received_at
    if len(events) < 100: sleep(5)
```

The sink doesn't push — consumers pull. This makes the sink stateless with respect to business logic and lets consumers retry/backfill freely.

## Non-goals

- **Business logic.** The sink persists and exposes; it does not decide.
- **Multi-tenant event routing.** One sink per LemonSqueezy account.
- **HA replication.** SQLite with WAL is fine for tens of events/sec. For higher volume or HA, point `WEBHOOK_SINK_DB` at an NFS mount or swap the store adapter (future work).

## Development

```bash
npm install
npm run lint
npm test
```

## License

MIT
