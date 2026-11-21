import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";
import { decryptSecret, encryptSecret, toHex } from "../src/crypto";
import { claimJobs, sendJob } from "../src/queue/engine";
import { refreshDueTokens } from "../src/scheduled";

const E: any = { ...env, IG_LOGIN_MODE: "unified", META_APP_ID: "1612067306883077", FB_LOGIN_CONFIG_ID: "1599197921970843" };
const IG = "17841400000000099";
const H = { Authorization: "Bearer test-token", "Content-Type": "application/json" };
const admin = (path: string, init: RequestInit = {}, e: any = E) => app.request(path, { ...init, headers: { ...H, ...(init.headers as object) } }, e);
const pub = (path: string, init: RequestInit = {}, e: any = E) => app.request(path, init, e);
const db = env.DB;
const json = (b: unknown, status = 200) => new Response(typeof b === "string" ? b : JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
function mock(routes: [RegExp, (u: URL, init?: RequestInit) => Response][]) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    calls.push({ url, init });
    for (const [re, fn] of routes) if (re.test(url.toString())) return fn(url, init);
    throw new Error(`unexpected fetch ${url}`);
  });
  return calls;
}
async function state() {
  const { authorizeUrl } = await (await admin("/api/v1/instagram/connect", { method: "POST" })).json<any>();
  return new URL(authorizeUrl);
}
async function seedUnified() {
  await db.prepare("INSERT INTO instagram_accounts (id, ig_user_id, username, access_token_enc, connected_at, status, login_mode, token_expires_at) VALUES ('u', ?, 'trendism.in', ?, ?, 'connected', 'unified', NULL)")
    .bind(IG, await encryptSecret("EAAunified_system_user_token_abcdefghijklmnop", E.TOKEN_ENCRYPTION_KEY, IG), new Date(Date.now() - 40 * 86_400_000).toISOString()).run();
}

beforeEach(async () => { for (const t of ["dm_attempts", "dm_jobs", "webhook_events", "automations", "instagram_accounts", "oauth_states", "app_logs", "collection_products", "collections", "products"]) await db.prepare(`DELETE FROM ${t}`).run(); });
afterEach(() => vi.restoreAllMocks());

describe("Unified login (Facebook Login for Business)", () => {
  it("reports what's missing for unified mode", async () => {
    const s: any = await (await admin("/api/v1/instagram/status", {}, { ...E, META_APP_SECRET: undefined, FB_LOGIN_CONFIG_ID: "" })).json();
    expect(s.config).toMatchObject({ loginMode: "unified", ready: false, missing: ["FB_LOGIN_CONFIG_ID", "META_APP_SECRET"] });
  });

  it("starts the Facebook Login for Business dialog with the login configuration", async () => {
    const u = await state();
    expect(u.origin + u.pathname).toBe("https://www.facebook.com/dialog/oauth");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ client_id: "1612067306883077", config_id: "1599197921970843", redirect_uri: "https://aos.example/oauth/instagram/callback", response_type: "code" });
    expect(u.searchParams.get("state")!.length).toBeGreaterThanOrEqual(40);
  });

  it("exchanges the code with the Meta app secret, finds the shared Instagram account and stores a non-expiring token", async () => {
    const st = (await state()).searchParams.get("state");
    const calls = mock([
      [/graph\.facebook\.com\/v27\.0\/oauth\/access_token\?/, () => json({ access_token: "EAAunified_system_user_token_abcdefghijklmnop", token_type: "bearer" })],
      [/graph\.facebook\.com\/v27\.0\/me\/assigned_instagram_accounts\?/, () => json(`{"data":[{"id":${IG},"username":"trendism.in"}]}`)],
      [new RegExp(`graph\\.facebook\\.com/v27\\.0/${IG}/subscribed_apps\\?`), () => json({ success: true })],
    ]);
    const res = await pub(`/oauth/instagram/callback?code=CODE&state=${st}`);
    expect(await res.text()).toContain("Connected as @trendism.in");
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toMatchObject({ client_id: "1612067306883077", client_secret: "test-meta-app-secret", code: "CODE", redirect_uri: "https://aos.example/oauth/instagram/callback" });
    const row: any = await db.prepare("SELECT * FROM instagram_accounts").first();
    expect(row).toMatchObject({ ig_user_id: IG, login_mode: "unified", token_expires_at: null, webhooks_subscribed: 1, status: "connected" });
    expect(await decryptSecret(row.access_token_enc, E.TOKEN_ENCRYPTION_KEY, IG)).toBe("EAAunified_system_user_token_abcdefghijklmnop");
    const s: any = await (await admin("/api/v1/instagram/status")).json();
    expect(s.account).toMatchObject({ loginMode: "unified", tokenExpiresAt: null });
  });

  it("explains when no Instagram account was shared during login", async () => {
    const st = (await state()).searchParams.get("state");
    mock([[/oauth\/access_token/, () => json({ access_token: "EAAx_token_abcdefghijklmnopqrstu" })], [/assigned_instagram_accounts/, () => json({ data: [] })]]);
    const res = await pub(`/oauth/instagram/callback?code=C&state=${st}`);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("No Instagram account selected");
    expect(await db.prepare("SELECT COUNT(*) n FROM instagram_accounts").first()).toEqual({ n: 0 });
  });

  it("sends private replies via graph.facebook.com/<IG id>/messages with the system-user token", async () => {
    await seedUnified();
    const p: any = await (await admin("/api/v1/products", { method: "POST", body: JSON.stringify({ affiliateUrl: "https://www.amazon.in/dp/B0UNIFIED1", platform: "amazon", title: "U" }) })).json();
    const col: any = await (await admin("/api/v1/collections", { method: "POST", body: JSON.stringify({ name: "Uni" }) })).json();
    await admin(`/api/v1/collections/${col.id}/products`, { method: "PUT", body: JSON.stringify({ productIds: [p.id] }) });
    await admin(`/api/v1/collections/${col.id}`, { method: "PATCH", body: JSON.stringify({ isPublished: true }) });
    await db.prepare("INSERT INTO dm_jobs (id, comment_id, media_id, collection_id, message, collection_url, status, received_at, recipient_ref) VALUES ('j','c9','m',?, 'hi https://aos.example/c/uni?s=instagram','https://aos.example/c/uni?s=instagram','pending',?, 'r1')").bind(col.id, new Date().toISOString()).run();
    const calls = mock([[new RegExp(`^https://graph\\.facebook\\.com/v27\\.0/${IG}/messages$`), () => json({ recipient_id: "r1", message_id: "m.1" })]]);
    const [job] = await claimJobs(E, "11111111-1111-4111-8111-111111111111", 1);
    const r = await sendJob(E, "https://aos.example", job!.id, "11111111-1111-4111-8111-111111111111", undefined);
    expect(r.body.outcome).toBe("sent");
    expect((calls[0]!.init!.headers as any).Authorization).toBe("Bearer EAAunified_system_user_token_abcdefghijklmnop");
  });

  it("never tries to refresh a non-expiring token; manual refresh explains why", async () => {
    await seedUnified();
    const f = vi.spyOn(globalThis, "fetch");
    expect(await refreshDueTokens(E)).toEqual({ checked: 0, refreshed: 0, failed: 0 });
    expect(f).not.toHaveBeenCalled();
    const r = await admin("/api/v1/instagram/refresh-token", { method: "POST" });
    expect(r.status).toBe(409);
    expect((await r.json<any>()).error.message).toMatch(/doesn't expire/);
  });

  it("check reads the Instagram account and subscriptions on graph.facebook.com", async () => {
    await seedUnified();
    mock([
      [new RegExp(`graph\\.facebook\\.com/v27\\.0/${IG}\\?fields=`), () => json({ id: IG, username: "trendism.in", profile_picture_url: "https://cdn/x.jpg" })],
      [new RegExp(`graph\\.facebook\\.com/v27\\.0/${IG}/subscribed_apps\\?`), () => json({ data: [{ subscribed_fields: ["comments"] }] })],
    ]);
    const s: any = await (await admin("/api/v1/instagram/check", { method: "POST" })).json();
    expect(s.account).toMatchObject({ username: "trendism.in", webhooksSubscribed: true, status: "connected" });
  });

  it("a verified deauthorize from Meta disconnects the Unified login account", async () => {
    await seedUnified();
    const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const payload = b64u(new TextEncoder().encode(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "fb-user-123" })));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(E.META_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = b64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
    expect((await pub("/oauth/instagram/deauthorize", { method: "POST", body: new URLSearchParams({ signed_request: `${sig}.${payload}` }) })).status).toBe(200);
    expect(await db.prepare("SELECT COUNT(*) n FROM instagram_accounts").first()).toEqual({ n: 0 });
  });

  it("logs a refused webhook handshake with a diagnosis but never the token", async () => {
    await pub("/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong%40token%23x&hub.challenge=1");
    const l: any = await db.prepare("SELECT message FROM app_logs WHERE code = 'verify_token_mismatch'").first();
    expect(l.message).toMatch(/token length 13 \(expected 17\).*non-hex/);
    expect(l.message).not.toContain("wrong@token");
  });
});
