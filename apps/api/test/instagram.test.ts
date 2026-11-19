import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";
import { decryptSecret, encryptSecret, quoteBigInts, toHex } from "../src/crypto";
import { classifyGraphError } from "../src/instagram/graph";
import { refreshDueTokens } from "../src/scheduled";

const E: any = env;
const KEY = E.TOKEN_ENCRYPTION_KEY as string;
const H = { Authorization: "Bearer test-token", "Content-Type": "application/json" };
const admin = (path: string, init: RequestInit = {}, e: any = env) => app.request(path, { ...init, headers: { ...H, ...(init.headers as object) } }, e);
const pub = (path: string, init: RequestInit = {}, e: any = env) => app.request(path, init, e);
const enc = new TextEncoder();

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body))));
}
const deliver = async (body: string, secret = E.IG_APP_SECRET, e: any = env) =>
  pub("/webhooks/instagram", { method: "POST", body, headers: { "Content-Type": "application/json", "X-Hub-Signature-256": await sign(body, secret) } }, e);

/** Route-based fetch mock for Instagram endpoints; any unexpected URL fails the test. */
function mockInstagram(routes: Array<[RegExp, (url: URL, init?: RequestInit) => Response | Promise<Response>]>) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    calls.push({ url, init });
    for (const [re, fn] of routes) if (re.test(url.toString())) return fn(url, init);
    throw new Error(`unexpected fetch ${url}`);
  });
  return calls;
}
const json = (body: unknown, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const IG_ID = "17841400000000001"; // > 2^53: must survive as a string
async function insertAccount(over: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const row = { id: "acc1", ig_user_id: IG_ID, username: "trendism.in", token: "IGAAlongtoken_abcdefghijklmnopqrstuvwxyz0123", token_expires_at: new Date(Date.now() + 50 * 86_400_000).toISOString(), token_refreshed_at: now, connected_at: now, status: "connected", ...over };
  await env.DB.prepare("INSERT INTO instagram_accounts (id, ig_user_id, username, access_token_enc, token_expires_at, token_refreshed_at, connected_at, status, webhooks_subscribed) VALUES (?,?,?,?,?,?,?,?,1)")
    .bind(row.id, row.ig_user_id, row.username, await encryptSecret(String(row.token), KEY, String(row.ig_user_id)), row.token_expires_at, row.token_refreshed_at, row.connected_at, row.status).run();
  return row;
}

beforeEach(async () => {
  for (const t of ["webhook_events", "instagram_accounts", "oauth_states", "data_deletion_requests", "app_logs"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});
afterEach(() => vi.restoreAllMocks());

describe("crypto", () => {
  it("encrypts tokens with AES-GCM bound to the account id", async () => {
    const blob = await encryptSecret("secret-token", KEY, "acct-1");
    expect(blob).toMatch(/^v1\./);
    expect(blob).not.toContain("secret-token");
    expect(await decryptSecret(blob, KEY, "acct-1")).toBe("secret-token");
    await expect(decryptSecret(blob, KEY, "acct-2")).rejects.toThrow();
    const [v, iv, ct] = blob.split(".");
    await expect(decryptSecret(`${v}.${iv}.${ct!.slice(0, -2)}AA`, KEY, "acct-1")).rejects.toThrow();
  });
  it("preserves big integer ids without touching string contents", () => {
    const out = JSON.parse(quoteBigInts('{"user_id":17841400000000001,"n":5,"t":"call 1234567890123456, ok","a":[17841400000000002]}'));
    expect(out).toEqual({ user_id: "17841400000000001", n: 5, t: "call 1234567890123456, ok", a: ["17841400000000002"] });
  });
  it("classifies Graph errors", () => {
    expect(classifyGraphError(400, { code: 190, message: "Error validating access token" }).kind).toBe("token_invalid");
    expect(classifyGraphError(400, { code: 10, message: "Permission denied" }).kind).toBe("permission_missing");
    expect(classifyGraphError(400, { code: 613 }).kind).toBe("rate_limited");
    expect(classifyGraphError(500, { code: 2 }).kind).toBe("temporary");
    expect(classifyGraphError(400, { code: 100 }).kind).toBe("invalid_request");
    expect(classifyGraphError(400, { code: 4 }).retryable).toBe(true);
    expect(classifyGraphError(400, { code: 190, message: "bad token IGAAabcdefghijklmnopqrstuvwxyz0123456789" }).message).not.toContain("IGAAabcdefghijklmnopqrstuvwxyz");
  });
});

describe("webhook verification handshake", () => {
  it("echoes the challenge only for the right verify token", async () => {
    const ok = await pub("/webhooks/instagram?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=1158201444");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1158201444");
    expect((await pub("/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1")).status).toBe(403);
    expect((await pub("/webhooks/instagram?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=1", {}, { ...E, IG_WEBHOOK_VERIFY_TOKEN: undefined })).status).toBe(503);
  });
});

const commentChanges = (id: string, text = "LINK") => JSON.stringify({ object: "instagram", entry: [{ id: IG_ID, time: 1795127000, changes: [{ field: "comments", value: { from: { id: "990001", username: "shopper_1" }, media: { id: "18000000000000123", media_product_type: "REELS" }, id, text } }] }] });
const commentFlat = (id: string) => `{"object":"instagram","entry":[{"id":"${IG_ID}","time":1795127000,"field":"comments","value":{"id":"${id}","from":{"id":"990002","username":"shopper_2"},"text":"link please","media":{"id":18000000000000456,"media_product_type":"REELS"}}}]}`;

describe("webhook deliveries", () => {
  const rows = () => env.DB.prepare("SELECT * FROM webhook_events ORDER BY received_at").all<any>().then((r) => r.results);

  it("stores a signed comment (changes[] shape) with normalized fields", async () => {
    const res = await deliver(commentChanges("17900000000000001"));
    expect(res.status).toBe(200);
    const [r] = await rows();
    // Stored, then immediately processed: with no automation on this post it is ignored (with the reason recorded).
    expect(r).toMatchObject({ dedupe_key: "comment:17900000000000001", event_type: "comments", process_status: "ignored", error: "No active automation for this post", ig_user_id: IG_ID, media_id: "18000000000000123", comment_id: "17900000000000001", from_username: "shopper_1", comment_text: "LINK", signature_key: "instagram", delivery_count: 1 });
  });

  it("accepts the Instagram-Login sample shape (entry.field/value) and keeps big numeric ids exact", async () => {
    expect((await deliver(commentFlat("17900000000000002"))).status).toBe(200);
    const [r] = await rows();
    expect(r).toMatchObject({ comment_id: "17900000000000002", media_id: "18000000000000456", from_username: "shopper_2", comment_text: "link please" });
  });

  it("accepts the Meta app secret too and records which secret matched", async () => {
    expect((await deliver(commentChanges("17900000000000003"), E.META_APP_SECRET)).status).toBe(200);
    expect((await rows())[0].signature_key).toBe("meta");
  });

  it("deduplicates redeliveries and counts them", async () => {
    const body = commentChanges("17900000000000004");
    await deliver(body); await deliver(body); await deliver(body);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0].delivery_count).toBe(3);
  });

  it("rejects missing or invalid signatures and stores nothing", async () => {
    const body = commentChanges("17900000000000005");
    expect((await pub("/webhooks/instagram", { method: "POST", body })).status).toBe(401);
    expect((await deliver(body, "not-the-secret")).status).toBe(401);
    expect(await rows()).toHaveLength(0);
    const logs = await env.DB.prepare("SELECT code FROM app_logs WHERE module='webhook'").all<any>();
    expect(logs.results.map((l) => l.code)).toEqual(expect.arrayContaining(["signature_missing", "signature_mismatch"]));
  });

  it("throttles log rows for rejected deliveries so the public endpoint can't flood the log table", async () => {
    for (let i = 0; i < 5; i++) await pub("/webhooks/instagram", { method: "POST", body: "{}", headers: { "X-Hub-Signature-256": "sha256=" + "0".repeat(64) } });
    const n = await env.DB.prepare("SELECT COUNT(*) n FROM app_logs WHERE code = 'signature_mismatch'").first<any>();
    expect(n.n).toBe(1);
  });

  it("returns 503 (so Meta retries) when no app secret is configured", async () => {
    const res = await deliver(commentChanges("17900000000000006"), "x", { ...E, IG_APP_SECRET: undefined, META_APP_SECRET: undefined });
    expect(res.status).toBe(503);
  });

  it("keeps signed but malformed payloads for review instead of dropping them", async () => {
    expect((await deliver("{not json")).status).toBe(200);
    expect((await deliver(JSON.stringify({ object: "instagram", entry: [{ id: IG_ID, changes: [{ field: "comments", value: { text: "no id" } }] }] }))).status).toBe(200);
    expect((await rows()).map((r) => r.process_status)).toEqual(["malformed", "malformed"]);
  });

  it("ignores other fields/objects and never stores direct-message content", async () => {
    await deliver(JSON.stringify({ object: "page", entry: [] }));
    await deliver(JSON.stringify({ object: "instagram", entry: [{ id: IG_ID, messaging: [{ sender: { id: "1" }, message: { mid: "m1", text: "private hello" } }] }] }));
    const r = await rows();
    expect(r.map((x) => x.process_status)).toEqual(["ignored", "ignored"]);
    expect(JSON.stringify(r)).not.toContain("private hello");
  });

  it("handles a batch with several entries and changes", async () => {
    const body = JSON.stringify({ object: "instagram", entry: [
      { id: IG_ID, changes: [{ field: "comments", value: { id: "c1", text: "a" } }, { field: "comments", value: { id: "c2", text: "b" } }] },
      { id: IG_ID, changes: [{ field: "comments", value: { id: "c3", text: "c" } }] },
    ] });
    expect((await deliver(body)).status).toBe(200);
    expect((await rows()).map((r) => r.comment_id).sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("rejects oversized bodies", async () => {
    const big = JSON.stringify({ object: "instagram", entry: [], pad: "x".repeat(1_100_000) });
    expect((await deliver(big)).status).toBe(413);
  });
});

describe("OAuth connect flow", () => {
  it("starts OAuth with a single-use state and the documented parameters", async () => {
    const res = await admin("/api/v1/instagram/connect", { method: "POST" });
    expect(res.status).toBe(200);
    const { authorizeUrl } = await res.json<any>();
    const u = new URL(authorizeUrl);
    expect(u.origin + u.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ client_id: "1234567890", redirect_uri: "https://aos.example/oauth/instagram/callback", response_type: "code", scope: "instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages" });
    const state = u.searchParams.get("state")!;
    expect(state.length).toBeGreaterThanOrEqual(40);
    expect(await env.DB.prepare("SELECT used_at FROM oauth_states WHERE state = ?").bind(state).first()).toMatchObject({ used_at: null });
  });

  it("refuses to start when configuration is missing and says what is missing", async () => {
    const res = await admin("/api/v1/instagram/connect", { method: "POST" }, { ...E, IG_APP_ID: "", TOKEN_ENCRYPTION_KEY: "short" });
    expect(res.status).toBe(503);
    expect((await res.json<any>()).missing).toEqual(["IG_APP_ID", "TOKEN_ENCRYPTION_KEY"]);
  });

  async function startState() {
    const { authorizeUrl } = await (await admin("/api/v1/instagram/connect", { method: "POST" })).json<any>();
    return new URL(authorizeUrl).searchParams.get("state")!;
  }
  const happyRoutes = (opts: { subscribe?: Response } = {}) => mockInstagram([
    [/^https:\/\/api\.instagram\.com\/oauth\/access_token$/, () => json(`{"data":[{"access_token":"IGAAshort_token_abcdefghijklmnopqrstuvwxyz","user_id":${IG_ID},"permissions":"instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages"}]}`)],
    [/^https:\/\/graph\.instagram\.com\/access_token\?/, () => json({ access_token: "IGAAlong_token_abcdefghijklmnopqrstuvwxyz0123", token_type: "bearer", expires_in: 5183944 })],
    [/^https:\/\/graph\.instagram\.com\/v27\.0\/me\?/, () => json(`{"id":"990","user_id":${IG_ID},"username":"trendism.in","account_type":"BUSINESS","profile_picture_url":"https://cdn.example/p.jpg"}`)],
    [/^https:\/\/graph\.instagram\.com\/v27\.0\/me\/subscribed_apps\?/, () => opts.subscribe ?? json({ success: true })],
  ]);

  it("exchanges the code, stores an encrypted long-lived token and subscribes to comment webhooks", async () => {
    const state = await startState();
    const calls = happyRoutes();
    const res = await pub(`/oauth/instagram/callback?code=AUTHCODE123%23_&state=${state}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Connected as @trendism.in");

    const form = new URLSearchParams(String(calls[0]!.init!.body));
    expect(Object.fromEntries(form)).toMatchObject({ client_id: "1234567890", client_secret: "test-ig-app-secret", grant_type: "authorization_code", redirect_uri: "https://aos.example/oauth/instagram/callback", code: "AUTHCODE123" });

    const row: any = await env.DB.prepare("SELECT * FROM instagram_accounts").first();
    expect(row).toMatchObject({ ig_user_id: IG_ID, app_scoped_id: "990", username: "trendism.in", account_type: "BUSINESS", status: "connected", webhooks_subscribed: 1, last_error: null });
    expect(row.access_token_enc).not.toContain("IGAAlong");
    expect(await decryptSecret(row.access_token_enc, KEY, IG_ID)).toBe("IGAAlong_token_abcdefghijklmnopqrstuvwxyz0123");
    expect(Date.parse(row.token_expires_at) - Date.now()).toBeGreaterThan(59 * 86_400_000);

    // The state cannot be replayed.
    expect((await pub(`/oauth/instagram/callback?code=AUTHCODE123&state=${state}`)).status).toBe(400);

    // Status shows the account but never the token.
    const status = await (await admin("/api/v1/instagram/status")).text();
    expect(status).toContain("trendism.in");
    expect(status).not.toMatch(/IGAA|access_token_enc/);
    const logs = await env.DB.prepare("SELECT message FROM app_logs").all<any>();
    expect(JSON.stringify(logs.results)).not.toContain("IGAA");
  });

  it("stays connected but records the problem when the webhook subscription fails", async () => {
    const state = await startState();
    happyRoutes({ subscribe: json({ error: { message: "Insufficient permission", code: 10 } }, 400) });
    const res = await pub(`/oauth/instagram/callback?code=X&state=${state}`);
    expect(res.status).toBe(200);
    const row: any = await env.DB.prepare("SELECT webhooks_subscribed, last_error, status FROM instagram_accounts").first();
    expect(row).toMatchObject({ webhooks_subscribed: 0, status: "connected" });
    expect(row.last_error).toContain("Webhook subscription failed");
  });

  it("rejects unknown/expired states, handles cancellation, and reports exchange failures without storing anything", async () => {
    expect((await pub("/oauth/instagram/callback?code=X&state=" + "a".repeat(43))).status).toBe(400);
    await env.DB.prepare("INSERT INTO oauth_states (state, expires_at) VALUES (?, ?)").bind("b".repeat(43), new Date(Date.now() - 1000).toISOString()).run();
    expect((await pub("/oauth/instagram/callback?code=X&state=" + "b".repeat(43))).status).toBe(400);

    const s1 = await startState();
    const cancelled = await pub(`/oauth/instagram/callback?error=access_denied&error_reason=user_denied&state=${s1}`);
    expect(await cancelled.text()).toContain("Connection cancelled");

    const s2 = await startState();
    mockInstagram([[/api\.instagram\.com/, () => json({ error_type: "OAuthException", code: 400, error_message: "Matching code was not found or was already used" }, 400)]]);
    const failed = await pub(`/oauth/instagram/callback?code=X&state=${s2}`);
    expect(failed.status).toBe(502);
    expect(await failed.text()).toContain("Matching code was not found");
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM instagram_accounts").first<any>()).toMatchObject({ n: 0 });
  });
});

describe("account management", () => {
  it("check marks the account expired when Instagram rejects the token", async () => {
    await insertAccount();
    mockInstagram([[/\/me\?/, () => json({ error: { message: "Error validating access token: Session has expired", type: "OAuthException", code: 190 } }, 400)]]);
    const res = await admin("/api/v1/instagram/check", { method: "POST" });
    expect(res.status).toBe(502);
    expect((await res.json<any>()).error.code).toBe("token_invalid");
    expect(await env.DB.prepare("SELECT status FROM instagram_accounts").first<any>()).toMatchObject({ status: "expired" });
  });

  it("check refreshes profile and subscription state", async () => {
    await insertAccount();
    mockInstagram([
      [/\/me\?/, () => json({ id: "990", user_id: IG_ID, username: "renamed", account_type: "MEDIA_CREATOR" })],
      [/\/me\/subscribed_apps/, () => json({ data: [{ subscribed_fields: ["comments"] }] })],
    ]);
    const s: any = await (await admin("/api/v1/instagram/check", { method: "POST" })).json();
    expect(s.account).toMatchObject({ username: "renamed", accountType: "MEDIA_CREATOR", webhooksSubscribed: true, status: "connected" });
  });

  it("lists recent media for automation setup", async () => {
    await insertAccount();
    mockInstagram([[/\/me\/media\?/, () => json({ data: [{ id: "18000000000000123", caption: "Winter fits", media_type: "VIDEO", media_product_type: "REELS", permalink: "https://www.instagram.com/reel/abc/", thumbnail_url: "https://cdn.example/t.jpg", timestamp: "2026-11-01T10:00:00+0000" }], paging: { cursors: { after: "QVFI" }, next: "https://graph.instagram.com/next" } })]]);
    const r: any = await (await admin("/api/v1/instagram/media")).json();
    expect(r.items[0]).toMatchObject({ id: "18000000000000123", mediaProductType: "REELS", thumbnailUrl: "https://cdn.example/t.jpg" });
    expect(r.after).toBe("QVFI");
  });

  it("disconnect deletes the stored token even if Instagram can't be reached", async () => {
    await insertAccount();
    mockInstagram([[/subscribed_apps/, () => { throw new Error("offline"); }]]);
    const s: any = await (await admin("/api/v1/instagram/disconnect", { method: "POST" })).json();
    expect(s.account).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM instagram_accounts").first<any>()).toMatchObject({ n: 0 });
  });

  it("lists webhook events newest first", async () => {
    await deliver(commentChanges("e1"));
    await deliver(commentChanges("e2", "link pls"));
    const r: any = await (await admin("/api/v1/instagram/events")).json();
    expect(r.items.map((i: any) => i.commentId)).toEqual(["e2", "e1"]);
    expect(r.items[0]).toMatchObject({ fromUsername: "shopper_1", text: "link pls", status: "ignored", error: "No active automation for this post" });
  });
});

describe("scheduled token refresh", () => {
  it("refreshes tokens close to expiry, leaves fresh ones alone, and marks invalid/expired ones", async () => {
    await insertAccount({ token_expires_at: new Date(Date.now() + 10 * 86_400_000).toISOString(), token_refreshed_at: new Date(Date.now() - 50 * 86_400_000).toISOString() });
    mockInstagram([[/refresh_access_token\?/, (u) => (u.searchParams.get("grant_type") === "ig_refresh_token" ? json({ access_token: "IGAArefreshed_token_abcdefghijklmnopqrstuvwxyz", token_type: "bearer", expires_in: 5183944 }) : json({}, 400))]]);
    expect(await refreshDueTokens(E)).toEqual({ checked: 1, refreshed: 1, failed: 0 });
    const row: any = await env.DB.prepare("SELECT * FROM instagram_accounts").first();
    expect(await decryptSecret(row.access_token_enc, KEY, IG_ID)).toBe("IGAArefreshed_token_abcdefghijklmnopqrstuvwxyz");
    expect(Date.parse(row.token_expires_at) - Date.now()).toBeGreaterThan(59 * 86_400_000);
    // Now fresh: no second refresh.
    expect(await refreshDueTokens(E)).toEqual({ checked: 1, refreshed: 0, failed: 0 });
  });

  it("marks the account expired when refresh is rejected or the token already expired", async () => {
    await insertAccount({ token_expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), token_refreshed_at: new Date(Date.now() - 55 * 86_400_000).toISOString() });
    mockInstagram([[/refresh_access_token/, () => json({ error: { message: "Error validating access token", code: 190 } }, 400)]]);
    expect((await refreshDueTokens(E)).failed).toBe(1);
    expect(await env.DB.prepare("SELECT status FROM instagram_accounts").first<any>()).toMatchObject({ status: "expired" });

    await env.DB.prepare("DELETE FROM instagram_accounts").run();
    await insertAccount({ token_expires_at: new Date(Date.now() - 1000).toISOString() });
    expect((await refreshDueTokens(E)).failed).toBe(1);
    expect(await env.DB.prepare("SELECT status FROM instagram_accounts").first<any>()).toMatchObject({ status: "expired" });
  });
});

describe("Meta compliance callbacks", () => {
  async function signedRequest(payload: object, secret = E.IG_APP_SECRET) {
    const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const p = b64u(enc.encode(JSON.stringify(payload)));
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return `${b64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(p))))}.${p}`;
  }
  const post = (path: string, signed: string) => pub(path, { method: "POST", body: new URLSearchParams({ signed_request: signed }) });

  it("deauthorize deletes the stored account for a valid signed request only", async () => {
    await insertAccount();
    expect((await post("/oauth/instagram/deauthorize", await signedRequest({ algorithm: "HMAC-SHA256", user_id: IG_ID }, "wrong-secret"))).status).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM instagram_accounts").first<any>()).toMatchObject({ n: 1 });
    expect((await post("/oauth/instagram/deauthorize", await signedRequest({ algorithm: "HMAC-SHA256", user_id: IG_ID }))).status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM instagram_accounts").first<any>()).toMatchObject({ n: 0 });
  });

  it("data deletion returns a status URL and confirmation code", async () => {
    await insertAccount();
    const r: any = await (await post("/oauth/instagram/data-deletion", await signedRequest({ algorithm: "HMAC-SHA256", user_id: IG_ID }))).json();
    expect(r.url).toBe(`https://aos.example/oauth/instagram/deletion-status?code=${r.confirmation_code}`);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM instagram_accounts").first<any>()).toMatchObject({ n: 0 });
    const page = await pub(`/oauth/instagram/deletion-status?code=${r.confirmation_code}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Data deleted");
    expect((await pub("/oauth/instagram/deletion-status?code=nope-nope-nope")).status).toBe(404);
  });

  it("serves a privacy policy page", async () => {
    const res = await pub("/privacy");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Privacy Policy");
    expect(html).toContain("https://aos.example/oauth/instagram/data-deletion");
  });
});
