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
  private stmtFindByKey: Database.Statement<[string], { id: number }>;
  private stmtInsert: Database.Statement<[string, string, string | null, number, string]>;
  private stmtListAll: Database.Statement<[number, number], WebhookRecord>;
  private stmtListByType: Database.Statement<[number, string, number], WebhookRecord>;
  private stmtMarkProcessed: Database.Statement<[number]>;
  private stmtCountTotal: Database.Statement<[], { c: number }>;
  private stmtCountUnprocessed: Database.Statement<[], { c: number }>;
  private stmtMaxReceivedAt: Database.Statement<[], { m: number | null }>;
  private stmtPing: Database.Statement<[], { ok: number }>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(readFileSync(SCHEMA_PATH, "utf8"));

    this.stmtFindByKey = this.db.prepare<[string], { id: number }>("SELECT id FROM events WHERE event_key = ?");
    this.stmtInsert = this.db.prepare<[string, string, string | null, number, string]>(
      "INSERT INTO events (event_key, event_name, resource_id, received_at, payload) VALUES (?, ?, ?, ?, ?)",
    );
    this.stmtListAll = this.db.prepare<[number, number], WebhookRecord>(
      "SELECT * FROM events WHERE received_at > ? ORDER BY received_at ASC LIMIT ?",
    );
    this.stmtListByType = this.db.prepare<[number, string, number], WebhookRecord>(
      "SELECT * FROM events WHERE received_at > ? AND event_name = ? ORDER BY received_at ASC LIMIT ?",
    );
    this.stmtMarkProcessed = this.db.prepare<[number]>("UPDATE events SET processed = 1 WHERE id = ?");
    this.stmtCountTotal = this.db.prepare<[], { c: number }>("SELECT COUNT(*) as c FROM events");
    this.stmtCountUnprocessed = this.db.prepare<[], { c: number }>(
      "SELECT COUNT(*) as c FROM events WHERE processed = 0",
    );
    this.stmtMaxReceivedAt = this.db.prepare<[], { m: number | null }>("SELECT MAX(received_at) as m FROM events");
    this.stmtPing = this.db.prepare<[], { ok: number }>("SELECT 1 as ok");
  }

  /**
   * Insert an event. Dedupes on event_key -- if the key exists, returns the
   * existing row's id and `duplicate: true` without touching the row.
   */
  insert(input: InsertInput): InsertResult {
    const existing = this.stmtFindByKey.get(input.event_key);
    if (existing) return { id: existing.id, duplicate: true };

    const info = this.stmtInsert.run(
      input.event_key,
      input.event_name,
      input.resource_id,
      input.received_at,
      input.payload,
    );
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
    if (opts.type) return this.stmtListByType.all(since, opts.type, limit);
    return this.stmtListAll.all(since, limit);
  }

  markProcessed(id: number): void {
    this.stmtMarkProcessed.run(id);
  }

  stats(): { total: number; unprocessed: number; lastReceivedAt: number | null } {
    const totalRow = this.stmtCountTotal.get();
    const unprocRow = this.stmtCountUnprocessed.get();
    const lastRow = this.stmtMaxReceivedAt.get();
    return {
      total: totalRow?.c ?? 0,
      unprocessed: unprocRow?.c ?? 0,
      lastReceivedAt: lastRow?.m ?? null,
    };
  }

  /** Cheap liveness probe -- throws if the underlying DB handle is unhealthy. */
  ping(): void {
    this.stmtPing.get();
  }

  close(): void {
    this.db.close();
  }
}
