import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../schema.sql");

export interface WebhookRecord {
  id: number;
  event_key: string;
  event_name: string;
  resource_id: string | null;
  received_at: number;
  payload: string;
  processed: number;
}

export interface InsertInput {
  event_key: string;
  event_name: string;
  resource_id: string | null;
  received_at: number;
  payload: string;
}

/** Result of attempting to store a webhook. `duplicate: true` means it was already present. */
export interface InsertResult {
  id: number;
  duplicate: boolean;
}

export class EventStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  }

  /**
   * Insert an event. Dedupes on event_key — if the key exists, returns the
   * existing row's id and `duplicate: true` without touching the row.
   */
  insert(input: InsertInput): InsertResult {
    const existing = this.db
      .prepare<[string], { id: number }>("SELECT id FROM events WHERE event_key = ?")
      .get(input.event_key);
    if (existing) return { id: existing.id, duplicate: true };

    const info = this.db
      .prepare("INSERT INTO events (event_key, event_name, resource_id, received_at, payload) VALUES (?, ?, ?, ?, ?)")
      .run(input.event_key, input.event_name, input.resource_id, input.received_at, input.payload);
    return { id: info.lastInsertRowid as number, duplicate: false };
  }

  /**
   * Read events for reconciliation. `since` is the minimum `received_at`
   * (exclusive). `limit` caps the page size. Ordered by received_at ASC so
   * consumers can checkpoint by the last-seen timestamp.
   */
  list(opts: { since?: number; type?: string; limit?: number }): WebhookRecord[] {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
    const since = opts.since ?? 0;
    if (opts.type) {
      return this.db
        .prepare<[number, string, number], WebhookRecord>(
          "SELECT * FROM events WHERE received_at > ? AND event_name = ? ORDER BY received_at ASC LIMIT ?",
        )
        .all(since, opts.type, limit);
    }
    return this.db
      .prepare<[number, number], WebhookRecord>(
        "SELECT * FROM events WHERE received_at > ? ORDER BY received_at ASC LIMIT ?",
      )
      .all(since, limit);
  }

  markProcessed(id: number): void {
    this.db.prepare("UPDATE events SET processed = 1 WHERE id = ?").run(id);
  }

  stats(): { total: number; unprocessed: number; lastReceivedAt: number | null } {
    const totalRow = this.db.prepare<[], { c: number }>("SELECT COUNT(*) as c FROM events").get();
    const unprocRow = this.db.prepare<[], { c: number }>("SELECT COUNT(*) as c FROM events WHERE processed = 0").get();
    const lastRow = this.db.prepare<[], { m: number | null }>("SELECT MAX(received_at) as m FROM events").get();
    return {
      total: totalRow?.c ?? 0,
      unprocessed: unprocRow?.c ?? 0,
      lastReceivedAt: lastRow?.m ?? null,
    };
  }

  close(): void {
    this.db.close();
  }
}
