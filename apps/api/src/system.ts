import { Hono } from "hono";
import type { Env } from "./env";
import { log } from "./logger";

export const setState = (env: Env, key: string, value: string) =>
  env.DB.prepare("INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, value, new Date().toISOString()).run();
export const getState = async (env: Env, key: string) => (await env.DB.prepare("SELECT value FROM system_state WHERE key = ?").bind(key).first<{ value: string }>())?.value ?? null;

// ---------------- Backups ----------------
export const BACKUP_TABLES = ["products", "collections", "collection_products", "automations", "instagram_accounts", "webhook_events", "dm_jobs", "dm_attempts", "click_events", "collection_views", "data_deletion_requests", "app_logs", "system_state"] as const;
const BACKUP_PREFIX = "backups/";
export const BACKUP_KEEP = 14;

async function gzip(text: string): Promise<ArrayBuffer> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
}

/**
 * Logical snapshot of every table into R2 (gzipped JSON). Encrypted Instagram tokens stay encrypted.
 * Complements D1 Time Travel (point-in-time restore); see DEPLOYMENT.md for restore steps.
 */
export async function backupToR2(env: Env, now = new Date()) {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    const rows: Record<string, unknown>[] = [];
    let last = 0;
    for (;;) {
      const { results } = await env.DB.prepare(`SELECT rowid AS __rowid, * FROM ${t} WHERE rowid > ? ORDER BY rowid LIMIT 2000`).bind(last).all<Record<string, unknown>>();
      for (const r of results) { last = Number(r.__rowid); delete r.__rowid; rows.push(r); }
      if (results.length < 2000) break;
    }
    tables[t] = rows;
    counts[t] = rows.length;
  }
  const migrations = (await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>().catch(() => ({ results: [] as { name: string }[] }))).results.map((m) => m.name);
  const body = await gzip(JSON.stringify({ format: "affiliateos-backup", version: 1, createdAt: now.toISOString(), migrations, tables }));
  const key = `${BACKUP_PREFIX}affiliateos-${now.toISOString().replace(/[:.]/g, "-")}.json.gz`;
  await env.IMAGES.put(key, body, { httpMetadata: { contentType: "application/gzip" }, customMetadata: { rows: String(Object.values(counts).reduce((a, b) => a + b, 0)) } });

  // Keep the newest BACKUP_KEEP backups.
  const listed = await env.IMAGES.list({ prefix: BACKUP_PREFIX, limit: 1000 });
  const old = listed.objects.map((o) => o.key).sort().reverse().slice(BACKUP_KEEP);
  if (old.length) await env.IMAGES.delete(old);
  await setState(env, "last_backup", JSON.stringify({ key, at: now.toISOString(), bytes: body.byteLength, counts }));
  await log(env, { level: "info", persist: true, module: "system", operation: "backup", message: `Backup saved (${(body.byteLength / 1024).toFixed(1)} KB, ${Object.values(counts).reduce((a, b) => a + b, 0)} rows); ${old.length} old backup(s) removed` });
  return { key, bytes: body.byteLength, counts, pruned: old.length };
}

// ---------------- Retention ----------------
const DAY = 86_400_000;
export const RETENTION = { webhookEventsDays: 90, commentTextDays: 180, logsDays: 90, heartbeatsDays: 30 } as const;

/** Data minimisation: keep raw comment payloads and logs only as long as they're useful (see /privacy). */
export async function applyRetention(env: Env, now = new Date()) {
  const ago = (d: number) => new Date(now.getTime() - d * DAY).toISOString();
  const [ev, txt, logs, hb] = await env.DB.batch([
    env.DB.prepare("DELETE FROM webhook_events WHERE received_at < ? AND process_status != 'received'").bind(ago(RETENTION.webhookEventsDays)),
    env.DB.prepare("UPDATE dm_jobs SET comment_text = NULL WHERE received_at < ? AND comment_text IS NOT NULL").bind(ago(RETENTION.commentTextDays)),
    env.DB.prepare("DELETE FROM app_logs WHERE logged_at < ?").bind(ago(RETENTION.logsDays)),
    env.DB.prepare("DELETE FROM engine_heartbeats WHERE seen_at < ?").bind(ago(RETENTION.heartbeatsDays)),
  ]);
  const r = { webhookEvents: ev!.meta.changes, commentTexts: txt!.meta.changes, logs: logs!.meta.changes, heartbeats: hb!.meta.changes };
  if (Object.values(r).some(Boolean)) await log(env, { level: "info", persist: true, module: "system", operation: "retention", message: `Retention clean-up: ${r.webhookEvents} webhook events, ${r.commentTexts} comment texts, ${r.logs} log entries, ${r.heartbeats} heartbeats removed` });
  return r;
}

// ---------------- Status ----------------
export interface Check { id: string; label: string; status: "ok" | "warn" | "error"; detail: string }

export async function systemStatus(env: Env, now = new Date()): Promise<{ overall: Check["status"]; checks: Check[]; time: string }> {
  const checks: Check[] = [];
  const add = (id: string, label: string, status: Check["status"], detail: string) => checks.push({ id, label, status, detail });
  const age = (iso: string | null) => (iso ? (now.getTime() - Date.parse(iso)) / 3_600_000 : Infinity);
  const hrs = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);

  try { await env.DB.prepare("SELECT 1").first(); add("database", "Database (D1)", "ok", "Reachable"); }
  catch { add("database", "Database (D1)", "error", "Unreachable"); return { overall: "error", checks, time: now.toISOString() }; }
  try { await env.IMAGES.list({ limit: 1 }); add("storage", "Storage (R2)", "ok", "Reachable"); } catch { add("storage", "Storage (R2)", "error", "Unreachable"); }

  const acct = await env.DB.prepare("SELECT status, username, token_expires_at, webhooks_subscribed FROM instagram_accounts ORDER BY connected_at DESC LIMIT 1").first<Record<string, any>>();
  if (!acct) add("instagram", "Instagram", "warn", "Not connected — comments can't be answered");
  else if (acct.status !== "connected") add("instagram", "Instagram", "error", `@${acct.username}: ${acct.status}. Reconnect on the Instagram page`);
  else {
    const left = acct.token_expires_at ? (Date.parse(acct.token_expires_at) - now.getTime()) / DAY : null;
    if (left !== null && left < 7) add("instagram", "Instagram", "warn", `@${acct.username}: token expires in ${Math.max(0, Math.round(left))} days and the automatic refresh hasn't succeeded`);
    else if (!acct.webhooks_subscribed) add("instagram", "Instagram", "warn", `@${acct.username}: not subscribed to comment webhooks`);
    else add("instagram", "Instagram", "ok", `@${acct.username} connected${left !== null ? `; token valid for ${Math.round(left)} days` : ""}`);
  }

  const q = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM dm_jobs WHERE status = 'pending') pending,
      (SELECT MIN(received_at) FROM dm_jobs WHERE status = 'pending') oldest,
      (SELECT COUNT(*) FROM dm_jobs WHERE status = 'uncertain') uncertain,
      (SELECT COUNT(*) FROM dm_jobs WHERE status = 'failed' AND updated_at >= ?) failed24`).bind(new Date(now.getTime() - DAY).toISOString()).first<Record<string, any>>();
  const oldestH = age(q?.oldest ?? null);
  if (q?.uncertain) add("queue", "Message queue", "warn", `${q.uncertain} reply(ies) with an uncertain outcome need checking`);
  else if (q?.pending && oldestH > 24) add("queue", "Message queue", "warn", `${q.pending} pending; oldest waiting ${hrs(oldestH)}. Instagram allows replies only within 7 days`);
  else add("queue", "Message queue", q?.failed24 ? "warn" : "ok", `${q?.pending ?? 0} pending · ${q?.failed24 ?? 0} failed in the last 24 h`);

  const hb = await env.DB.prepare("SELECT MAX(seen_at) t FROM engine_heartbeats").first<{ t: string | null }>();
  const hbH = age(hb?.t ?? null);
  if (q?.pending && hbH > 0.25) add("engine", "Mac queue engine", "warn", `Not seen for ${hb?.t ? hrs(hbH) : "ever"} while ${q.pending} replies wait — open AffiliateOS to send them`);
  else add("engine", "Mac queue engine", "ok", hb?.t ? `Last seen ${hrs(hbH)} ago` : "Not started yet");

  const lastEvent = await env.DB.prepare("SELECT MAX(received_at) t FROM webhook_events").first<{ t: string | null }>();
  add("webhooks", "Instagram webhooks", "ok", lastEvent?.t ? `Last event ${hrs(age(lastEvent.t))} ago` : "No events received yet");

  const backup = JSON.parse((await getState(env, "last_backup")) ?? "null") as { at: string; bytes: number } | null;
  const bH = age(backup?.at ?? null);
  add("backup", "Backups", bH > 36 ? "warn" : "ok", backup ? `Last backup ${hrs(bH)} ago (${(backup.bytes / 1024).toFixed(1)} KB)` : "No backup yet — runs daily at 03:17 UTC");

  const cron = await getState(env, "last_cron");
  const cH = age(cron);
  add("cron", "Daily maintenance", cH > 36 ? "warn" : "ok", cron ? `Last run ${hrs(cH)} ago` : "Hasn't run yet (daily at 03:17 UTC)");

  const overall = checks.some((c) => c.status === "error") ? "error" : checks.some((c) => c.status === "warn") ? "warn" : "ok";
  return { overall, checks, time: now.toISOString() };
}

export const system = new Hono<{ Bindings: Env }>();
system.get("/status", async (c) => c.json(await systemStatus(c.env)));
system.post("/backup", async (c) => c.json(await backupToR2(c.env), 201));
system.get("/backups", async (c) => {
  const listed = await c.env.IMAGES.list({ prefix: BACKUP_PREFIX, limit: 1000, include: ["customMetadata"] } as R2ListOptions);
  return c.json({ items: listed.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded.toISOString(), rows: Number(o.customMetadata?.rows ?? 0) })).sort((a, b) => b.key.localeCompare(a.key)) });
});
