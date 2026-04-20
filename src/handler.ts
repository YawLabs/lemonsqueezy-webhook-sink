import { createHash } from "node:crypto";
import type { EventStore } from "./store.js";
import { verifySignature } from "./verify.js";

interface LemonsqueezyMeta {
  event_name?: string;
  custom_data?: Record<string, unknown>;
}

interface LemonsqueezyData {
  id?: string | number;
  type?: string;
  attributes?: { created_at?: string; [key: string]: unknown };
}

interface LemonsqueezyPayload {
  meta?: LemonsqueezyMeta;
  data?: LemonsqueezyData;
}

/**
 * Derive a stable dedupe key for a webhook payload.
 *
 * Preferred: `meta.custom_data.event_id` if the sender provides one (our own
 * checkout-create flows can set this). Fallback: SHA-256 of
 * `event_name + resource_type + resource_id + created_at`. This is stable
 * across LemonSqueezy's "same event delivered twice" retries because those
 * replay the identical payload.
 */
export function deriveEventKey(payload: LemonsqueezyPayload): string {
  const explicit = payload.meta?.custom_data?.event_id;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;

  const eventName = payload.meta?.event_name ?? "unknown";
  const resourceType = payload.data?.type ?? "unknown";
  const resourceId = payload.data?.id ?? "unknown";
  const createdAt = payload.data?.attributes?.created_at ?? "";
  return createHash("sha256").update(`${eventName}|${resourceType}|${resourceId}|${createdAt}`).digest("hex");
}

export interface HandlerDeps {
  store: EventStore;
  signingSecret: string;
  now?: () => number;
}

export interface HandlerInput {
  rawBody: string;
  signature: string | null;
}

export interface HandlerResult {
  status: 200 | 400 | 401;
  body: { ok: true; id: number; duplicate: boolean } | { ok: false; error: string };
}

export function handleWebhook(deps: HandlerDeps, input: HandlerInput): HandlerResult {
  if (!verifySignature(input.rawBody, input.signature, deps.signingSecret)) {
    return { status: 401, body: { ok: false, error: "invalid signature" } };
  }

  let parsed: LemonsqueezyPayload;
  try {
    parsed = JSON.parse(input.rawBody) as LemonsqueezyPayload;
  } catch {
    return { status: 400, body: { ok: false, error: "invalid json" } };
  }

  const eventName = parsed.meta?.event_name;
  if (!eventName) {
    return { status: 400, body: { ok: false, error: "missing meta.event_name" } };
  }

  const result = deps.store.insert({
    event_key: deriveEventKey(parsed),
    event_name: eventName,
    resource_id: parsed.data?.id !== undefined ? String(parsed.data.id) : null,
    received_at: (deps.now ?? Date.now)(),
    payload: input.rawBody,
  });

  return { status: 200, body: { ok: true, id: result.id, duplicate: result.duplicate } };
}
