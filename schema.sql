-- Webhook event store. One row per received webhook, deduplicated by LemonSqueezy's event_name + custom_data.event_id when present.
-- The payload is stored as raw JSON so the HMAC signature can be re-verified
-- against the original bytes if needed.

CREATE TABLE IF NOT EXISTS events (
  -- Surrogate primary key; external consumers should prefer `event_key`.
  id          INTEGER PRIMARY KEY AUTOINCREMENT,

  -- LemonSqueezy event identity. `event_key` is the dedupe key: either the
  -- `meta.custom_data.event_id` if the sender provides one, or a hash of
  -- (event_name + timestamp + resource_id) as a fallback. Unique so duplicate
  -- deliveries become a no-op insert.
  event_key   TEXT NOT NULL UNIQUE,
  event_name  TEXT NOT NULL,
  resource_id TEXT,

  -- When the sink received the event. Not the LS `created_at`.
  received_at INTEGER NOT NULL,

  -- Raw JSON payload as sent by LemonSqueezy (verbatim, pre-parse).
  payload     TEXT NOT NULL,

  -- Consumer bookkeeping. Consumers mark events processed via an UPDATE.
  processed   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_events_received_at ON events(received_at);
CREATE INDEX IF NOT EXISTS idx_events_name        ON events(event_name);
CREATE INDEX IF NOT EXISTS idx_events_processed   ON events(processed) WHERE processed = 0;
