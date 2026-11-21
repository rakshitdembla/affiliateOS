import { Hono } from "hono";
import type { Env } from "../env";
import { fromHex, hmacSha256, quoteBigInts, sha256Hex, timingSafeEqualBytes, timingSafeEqualStr } from "../crypto";
import { log, logThrottled } from "../logger";
import { igConfig, webhookSecrets } from "./config";
import { ingestEvents } from "../queue/ingest";

const MAX_BODY = 1_000_000;
const MAX_TEXT = 2200;

interface EventRow {
  dedupeKey: string; eventType: string; payload: string; status: "received" | "ignored" | "malformed"; error: string | null;
  igUserId: string | null; mediaId: string | null; commentId: string | null; parentId: string | null;
  fromId: string | null; fromUsername: string | null; text: string | null;
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/**
 * Turn a verified delivery into one row per change. Handles both documented shapes:
 * entry.changes[] = { field, value } (Facebook/Unified login) and entry.field/entry.value (Instagram Login sample).
 */
export async function normalizeWebhook(body: any, rawHash: string): Promise<EventRow[]> {
  const base = { igUserId: null, mediaId: null, commentId: null, parentId: null, fromId: null, fromUsername: null, text: null };
  if (!body || typeof body !== "object" || !Array.isArray(body.entry)) {
    return [{ ...base, dedupeKey: `raw:${rawHash}`, eventType: "unknown", payload: JSON.stringify(body ?? null).slice(0, 100_000), status: "malformed", error: "Missing entry array" }];
  }
  if (body.object !== "instagram") {
    return [{ ...base, dedupeKey: `raw:${rawHash}`, eventType: String(body.object ?? "unknown"), payload: JSON.stringify(body).slice(0, 100_000), status: "ignored", error: "Not an Instagram event" }];
  }
  const rows: EventRow[] = [];
  for (const entry of body.entry.slice(0, 1000)) {
    const igUserId = str(entry?.id);
    const changes: any[] = Array.isArray(entry?.changes) ? entry.changes : entry?.field ? [{ field: entry.field, value: entry.value }] : [];
    for (const change of changes) {
      const field = String(change?.field ?? "unknown");
      const v = change?.value ?? {};
      const payload = JSON.stringify({ entry_id: igUserId, time: entry?.time ?? null, field, value: v });
      if (field === "comments" || field === "live_comments") {
        const commentId = str(v.id ?? v.comment_id);
        if (!commentId) {
          rows.push({ ...base, igUserId, dedupeKey: `${field}:${await sha256Hex(payload)}`, eventType: field, payload, status: "malformed", error: "Comment event without a comment id" });
          continue;
        }
        rows.push({
          dedupeKey: `comment:${commentId}`, eventType: field, payload, status: "received", error: null, igUserId,
          mediaId: str(v.media?.id), commentId, parentId: str(v.parent_id), fromId: str(v.from?.id), fromUsername: str(v.from?.username),
          text: v.text == null ? null : String(v.text).slice(0, MAX_TEXT),
        });
      } else {
        rows.push({ ...base, igUserId, dedupeKey: `${field}:${await sha256Hex(payload)}`, eventType: field, payload, status: "ignored", error: "Field not used by AffiliateOS" });
      }
    }
    // Direct messages are not used; store only that one arrived (no message content).
    for (const m of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const mid = str(m?.message?.mid) ?? (await sha256Hex(JSON.stringify(m)));
      rows.push({ ...base, igUserId, dedupeKey: `message:${mid}`, eventType: "messages", payload: "{}", status: "ignored", error: "Direct messages are not processed" });
    }
  }
  if (!rows.length) rows.push({ ...base, dedupeKey: `raw:${rawHash}`, eventType: "empty", payload: JSON.stringify(body).slice(0, 100_000), status: "ignored", error: "No changes in delivery" });
  return rows;
}

export const webhooks = new Hono<{ Bindings: Env }>();

/** Subscription verification handshake from the Meta App Dashboard. */
webhooks.get("/webhooks/instagram", async (c) => {
  const expected = c.env.IG_WEBHOOK_VERIFY_TOKEN;
  if (!expected) return c.text("Webhook verify token is not configured", 503);
  const challenge = c.req.query("hub.challenge") ?? "";
  const given = c.req.query("hub.verify_token") ?? "";
  if (c.req.query("hub.mode") === "subscribe" && timingSafeEqualStr(given, expected) && challenge && challenge.length <= 200) {
    await log(c.env, { level: "info", persist: true, module: "webhook", operation: "verify", message: "Meta webhook subscription verified" });
    return c.text(challenge, 200);
  }
  // Describe the mismatch without revealing either token.
  await logThrottled(c.env, { level: "warn", module: "webhook", operation: "verify", code: "verify_token_mismatch",
    message: `Webhook verification refused: mode=${c.req.query("hub.mode") ?? "missing"}, token length ${given.length} (expected ${expected.length})${/\s/.test(given) ? ", contains whitespace" : ""}${/[^0-9a-f]/.test(given) ? ", contains non-hex characters" : ""}` }, 2);
  return c.text("Forbidden", 403);
});

/**
 * Event delivery. Only signature-verified payloads are stored. Anything that prevents safe storage returns a
 * non-2xx status so Meta retries (Meta retries failed deliveries for up to 36 hours) — events are never dropped silently.
 */
webhooks.post("/webhooks/instagram", async (c) => {
  const env = c.env;
  const secrets = webhookSecrets(env);
  if (!secrets.length) {
    await logThrottled(env, { level: "error", module: "webhook", operation: "receive", code: "not_configured", message: "Webhook delivery received but no app secret is configured; responded 503 so Meta retries" });
    return c.text("Not configured", 503);
  }
  if (Number(c.req.header("content-length") ?? 0) > MAX_BODY) return c.text("Payload too large", 413);
  const raw = await c.req.arrayBuffer();
  if (raw.byteLength > MAX_BODY) return c.text("Payload too large", 413);

  const m = /^sha256=([0-9a-f]{64})$/i.exec((c.req.header("x-hub-signature-256") ?? "").trim());
  let signatureKey: string | null = null;
  if (m) {
    const given = fromHex(m[1]!.toLowerCase());
    for (const [name, secret] of secrets) {
      if (timingSafeEqualBytes(await hmacSha256(secret, raw), given)) { signatureKey = name; break; }
    }
  }
  if (!signatureKey) {
    await logThrottled(env, { level: "warn", module: "webhook", operation: "verify_signature", code: m ? "signature_mismatch" : "signature_missing", message: m ? "Rejected delivery: signature did not match any configured app secret" : "Rejected delivery without X-Hub-Signature-256" });
    return c.text("Invalid signature", 401);
  }

  const text = new TextDecoder().decode(raw);
  const rawHash = await sha256Hex(raw);
  let body: unknown;
  let rows: EventRow[];
  try {
    body = JSON.parse(quoteBigInts(text));
    rows = await normalizeWebhook(body, rawHash);
  } catch {
    rows = [{ dedupeKey: `raw:${rawHash}`, eventType: "unknown", payload: text.slice(0, 100_000), status: "malformed", error: "Body is not valid JSON",
      igUserId: null, mediaId: null, commentId: null, parentId: null, fromId: null, fromUsername: null, text: null }];
  }

  try {
    await env.DB.batch(rows.map((r) => env.DB.prepare(
      `INSERT INTO webhook_events (id, dedupe_key, event_type, payload, signature_ok, process_status, error, ig_user_id, media_id, comment_id,
         parent_comment_id, from_id, from_username, comment_text, signature_key)
       VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(dedupe_key) DO UPDATE SET delivery_count = delivery_count + 1`,
    ).bind(crypto.randomUUID(), r.dedupeKey, r.eventType, r.payload, r.status, r.error, r.igUserId, r.mediaId, r.commentId, r.parentId,
      r.fromId, r.fromUsername, r.text, signatureKey)));
  } catch (e) {
    await log(env, { level: "error", module: "webhook", operation: "store", code: "db_error", message: `Could not store webhook delivery (${rows.length} events); responded 500 so Meta retries: ${(e as Error).message}` });
    return c.text("Storage error", 500);
  }
  if (rows.some((r) => r.status === "received")) {
    const work = ingestEvents(env, igConfig(env, c.req.url).base).catch((e) =>
      log(env, { level: "error", module: "automation", operation: "ingest", code: "ingest_failed", message: `Creating DM jobs failed (will retry on next sync): ${(e as Error).message}` }));
    try { c.executionCtx.waitUntil(work); } catch { await work; }
  }
  const malformed = rows.filter((r) => r.status === "malformed").length;
  if (malformed) await log(env, { level: "warn", module: "webhook", operation: "parse", code: "malformed", message: `Stored ${malformed} malformed webhook event(s) for review` });
  return c.text("EVENT_RECEIVED", 200);
});
