import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { encryptSecret, toHex } from "../src/crypto";
import { runScheduled } from "../src/scheduled";
import { applyRetention, backupToR2, BACKUP_KEEP, systemStatus } from "../src/system";

const E: any = env;
const db = env.DB;
const H = { Authorization: "Bearer test-token", "Content-Type": "application/json" };
const admin = (path: string, init: RequestInit = {}, e: any = env) => app.request(path, { ...init, headers: { ...H, ...(init.headers as object) } }, e);
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

async function gunzipJson(obj: R2ObjectBody) {
  return JSON.parse(await new Response(obj.body.pipeThrough(new DecompressionStream("gzip"))).text());
}

beforeEach(async () => {
  for (const t of ["dm_attempts", "dm_jobs", "webhook_events", "automations", "instagram_accounts", "collection_products", "collections", "products", "app_logs", "engine_heartbeats", "system_state", "click_events", "collection_views"]) await db.prepare(`DELETE FROM ${t}`).run();
  const listed = await env.IMAGES.list({ prefix: "backups/" });
  if (listed.objects.length) await env.IMAGES.delete(listed.objects.map((o) => o.key));
});

describe("backups", () => {
  it("snapshots every table into R2 as gzipped JSON; Instagram tokens stay encrypted", async () => {
    await admin("/api/v1/products", { method: "POST", body: JSON.stringify({ affiliateUrl: "https://www.amazon.in/dp/B0BACKUP01", platform: "amazon", title: "Backed up" }) });
    await db.prepare("INSERT INTO instagram_accounts (id, ig_user_id, username, access_token_enc, connected_at) VALUES ('a','17841400000000001','me',?,?)").bind(await encryptSecret("IGAAplaintext_token_should_never_appear_123", E.TOKEN_ENCRYPTION_KEY, "17841400000000001"), new Date().toISOString()).run();
    const r = await backupToR2(E);
    expect(r.counts).toMatchObject({ products: 1, instagram_accounts: 1 });
    const obj = await env.IMAGES.get(r.key);
    const data = await gunzipJson(obj!);
    expect(data).toMatchObject({ format: "affiliateos-backup", version: 1 });
    expect(data.migrations).toContain("0007_system_state.sql");
    expect(data.tables.products[0].title).toBe("Backed up");
    expect(JSON.stringify(data)).not.toContain("IGAAplaintext");
    const s: any = await (await admin("/api/v1/system/backups")).json();
    expect(s.items[0]).toMatchObject({ key: r.key, rows: expect.any(Number) });
  });

  it(`keeps only the newest ${BACKUP_KEEP} backups`, async () => {
    for (let i = 0; i < BACKUP_KEEP + 2; i++) await backupToR2(E, new Date(Date.UTC(2026, 10, 1 + i)));
    const listed = await env.IMAGES.list({ prefix: "backups/" });
    expect(listed.objects).toHaveLength(BACKUP_KEEP);
    expect(listed.objects.map((o) => o.key).sort()[0]).toContain("2026-11-03");
  });

  it("backups are never served publicly", async () => {
    const r = await backupToR2(E);
    expect((await app.request(`/img/${r.key}`, {}, env as any)).status).toBe(404);
    expect((await app.request(`/img/${encodeURIComponent(r.key)}`, {}, env as any)).status).toBe(404);
  });
});

describe("retention", () => {
  it("removes old processed webhook payloads, old comment text and old logs; keeps unprocessed events", async () => {
    const ins = (sql: string, ...a: unknown[]) => db.prepare(sql).bind(...a).run();
    await ins("INSERT INTO webhook_events (id, dedupe_key, event_type, payload, signature_ok, process_status, received_at) VALUES ('old','k1','comments','{}',1,'queued',?)", ago(100));
    await ins("INSERT INTO webhook_events (id, dedupe_key, event_type, payload, signature_ok, process_status, received_at) VALUES ('stuck','k2','comments','{}',1,'received',?)", ago(100));
    await ins("INSERT INTO webhook_events (id, dedupe_key, event_type, payload, signature_ok, process_status, received_at) VALUES ('new','k3','comments','{}',1,'queued',?)", ago(5));
    await ins("INSERT INTO dm_jobs (id, comment_id, media_id, message, received_at, comment_text) VALUES ('j','c','m','hi',?, 'personal text')", ago(200));
    await ins("INSERT INTO app_logs (id, level, module, message, logged_at) VALUES ('l','info','x','old',?)", ago(120));
    const r = await applyRetention(E);
    expect(r).toMatchObject({ webhookEvents: 1, commentTexts: 1, logs: 1 });
    expect((await db.prepare("SELECT id FROM webhook_events ORDER BY id").all<any>()).results.map((x) => x.id)).toEqual(["new", "stuck"]);
    expect(await db.prepare("SELECT comment_text, message FROM dm_jobs").first()).toEqual({ comment_text: null, message: "hi" });
  });
});

describe("system status", () => {
  const byId = async () => Object.fromEntries((await systemStatus(E)).checks.map((c) => [c.id, c]));
  it("flags what needs attention on a fresh install", async () => {
    const c = await byId();
    expect(c.database.status).toBe("ok");
    expect(c.storage.status).toBe("ok");
    expect(c.instagram).toMatchObject({ status: "warn", detail: expect.stringMatching(/Not connected/) });
    expect(c.backup.detail).toMatch(/No backup yet/);
  });

  it("warns about stale queues, a missing engine, uncertain replies and expiring tokens", async () => {
    await db.prepare("INSERT INTO instagram_accounts (id, ig_user_id, username, access_token_enc, connected_at, status, token_expires_at, webhooks_subscribed) VALUES ('a','1','me','x',?, 'connected', ?, 1)").bind(ago(50), new Date(Date.now() + 3 * DAY).toISOString()).run();
    await db.prepare("INSERT INTO dm_jobs (id, comment_id, media_id, message, status, received_at) VALUES ('j1','c1','m','hi','pending',?)").bind(ago(2)).run();
    let c = await byId();
    expect(c.instagram).toMatchObject({ status: "warn", detail: expect.stringMatching(/expires in 3 days/) });
    expect(c.queue).toMatchObject({ status: "warn", detail: expect.stringMatching(/oldest waiting 2 days/) });
    expect(c.engine).toMatchObject({ status: "warn", detail: expect.stringMatching(/open AffiliateOS/) });
    await db.prepare("INSERT INTO dm_jobs (id, comment_id, media_id, message, status, received_at) VALUES ('j2','c2','m','hi','uncertain',?)").bind(ago(0)).run();
    await db.prepare("INSERT INTO engine_heartbeats (worker_id, status, seen_at) VALUES ('w','idle',?)").bind(new Date().toISOString()).run();
    c = await byId();
    expect(c.queue.detail).toMatch(/uncertain outcome/);
    expect(c.engine.status).toBe("ok");
  });

  it("daily maintenance isolates failures and still records its run", async () => {
    const brokenR2 = new Proxy(env.IMAGES, { get: (t, p) => (p === "put" ? async () => { throw new Error("R2 down"); } : (t as any)[p]?.bind?.(t) ?? (t as any)[p]) });
    await db.prepare("INSERT INTO app_logs (id, level, module, message, logged_at) VALUES ('old','info','x','old',?)").bind(ago(120)).run();
    await runScheduled({ ...E, IMAGES: brokenR2 });
    const failed = await db.prepare("SELECT operation FROM app_logs WHERE code = 'cron_step_failed'").all<any>();
    expect(failed.results.map((r) => r.operation)).toEqual(["cron_backup"]);
    expect(await db.prepare("SELECT COUNT(*) n FROM app_logs WHERE id = 'old'").first()).toEqual({ n: 0 }); // retention still ran
    const c = await byId();
    expect(c.cron.status).toBe("ok");
  });

  it("is admin-only", async () => {
    expect((await app.request("/api/v1/system/status", {}, env as any)).status).toBe(401);
    expect((await (await admin("/api/v1/system/status")).json<any>()).checks.length).toBeGreaterThan(5);
  });
});

describe("abuse protection and failure handling", () => {
  it("over the per-IP limit, visitors are still served but views/clicks aren't recorded", async () => {
    const p: any = await (await admin("/api/v1/products", { method: "POST", body: JSON.stringify({ affiliateUrl: "https://www.amazon.in/dp/B0RATELIM1", platform: "amazon", title: "Rate" }) })).json();
    const col: any = await (await admin("/api/v1/collections", { method: "POST", body: JSON.stringify({ name: "Rate Test" }) })).json();
    await admin(`/api/v1/collections/${col.id}/products`, { method: "PUT", body: JSON.stringify({ productIds: [p.id] }) });
    await admin(`/api/v1/collections/${col.id}`, { method: "PATCH", body: JSON.stringify({ isPublished: true }) });
    const limited = { ...E, PUBLIC_RL: { limit: async () => ({ success: false }) } };
    const ua = { "User-Agent": "Mozilla/5.0 Safari", "CF-Connecting-IP": "203.0.113.9" };
    expect((await app.request(`/c/${col.slug}`, { headers: ua }, limited)).status).toBe(200);
    const go = await app.request(`/go/${p.id}`, { headers: ua, redirect: "manual" }, limited);
    expect(go.status).toBe(302);
    expect(go.headers.get("location")).toBe("https://www.amazon.in/dp/B0RATELIM1");
    expect(await db.prepare("SELECT (SELECT COUNT(*) FROM collection_views) v, (SELECT COUNT(*) FROM click_events) c").first()).toEqual({ v: 0, c: 0 });
    const allowed = { ...E, PUBLIC_RL: { limit: async () => ({ success: true }) } };
    await app.request(`/go/${p.id}`, { headers: ua, redirect: "manual" }, allowed);
    expect(await db.prepare("SELECT COUNT(*) n FROM click_events").first()).toEqual({ n: 1 });
  });

  it("a database failure while storing a webhook returns 500 so Meta retries (never 200 for a lost event)", async () => {
    const body = JSON.stringify({ object: "instagram", entry: [{ id: "1", changes: [{ field: "comments", value: { id: "c-fail", text: "LINK" } }] }] });
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(E.IG_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = "sha256=" + toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))));
    const brokenDb = new Proxy(env.DB, { get: (t, p) => (p === "batch" ? async () => { throw new Error("D1 unavailable"); } : (t as any)[p]?.bind?.(t) ?? (t as any)[p]) });
    const res = await app.request("/webhooks/instagram", { method: "POST", body, headers: { "X-Hub-Signature-256": sig } }, { ...E, DB: brokenDb });
    expect(res.status).toBe(500);
  });

  it("logs failed admin authentication (throttled) and sends security headers", async () => {
    for (let i = 0; i < 4; i++) await app.request("/api/v1/overview", { headers: { Authorization: "Bearer guess" } }, env as any);
    expect(await db.prepare("SELECT COUNT(*) n FROM app_logs WHERE code = 'auth_failed'").first()).toEqual({ n: 1 });
    const res = await app.request("/health", {}, env as any);
    expect(res.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
  });
});
