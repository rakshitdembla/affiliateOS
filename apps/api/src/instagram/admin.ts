import { Hono, type Context } from "hono";
import type { InstagramStatus, WebhookEventSummary } from "@affiliateos/shared";
import type { Env } from "../env";
import { encryptSecret, randomToken } from "../crypto";
import { log } from "../logger";
import { accountToken, getAccount, targetFor, toAccount, type AccountRow } from "./account";
import { igConfig } from "./config";
import { authorizeUrl, getIgAccount, getProfile, getSubscribedFields, GraphError, hostsFor, listMedia, refreshLongLived, subscribeWebhooks, unifiedAuthorizeUrl, unsubscribeWebhooks } from "./graph";

const bad = (c: Context, code: string, message: string, status: 400 | 404 | 409 | 502 | 503) => c.json({ error: { code, message } }, status);

async function status(env: Env, url: string): Promise<InstagramStatus> {
  const cfg = igConfig(env, url);
  const a = await getAccount(env);
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const s = await env.DB.prepare(
    "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END), 0) AS day, MAX(received_at) AS last FROM webhook_events",
  ).bind(dayAgo).first<{ total: number; day: number; last: string | null }>();
  const lastSig = await env.DB.prepare("SELECT signature_key FROM webhook_events ORDER BY received_at DESC, rowid DESC LIMIT 1").first<{ signature_key: string | null }>();
  return {
    config: {
      ready: cfg.missing.length === 0, loginMode: cfg.mode, missing: cfg.missing, graphVersion: cfg.version, metaSecretConfigured: !!env.META_APP_SECRET,
      redirectUri: cfg.redirectUri, webhookUrl: cfg.webhookUrl, privacyUrl: cfg.privacyUrl, deauthorizeUrl: cfg.deauthorizeUrl, dataDeletionUrl: cfg.dataDeletionUrl,
    },
    account: a ? toAccount(a) : null,
    webhooks: { total: s?.total ?? 0, last24h: s?.day ?? 0, lastReceivedAt: s?.last ?? null, lastSignatureKey: lastSig?.signature_key ?? null },
  };
}

/** Record a Graph failure on the account (expired token → status "expired") and build an API error. */
async function graphFailure(c: Context<{ Bindings: Env }>, a: AccountRow, e: unknown, operation: string) {
  const ge = e instanceof GraphError ? e : null;
  const message = ge?.message ?? "The stored token could not be used (was the encryption key changed?). Reconnect Instagram.";
  const now = new Date().toISOString();
  const newStatus = !ge ? "error" : ge.kind === "token_invalid" ? "expired" : a.status;
  await c.env.DB.prepare("UPDATE instagram_accounts SET status = ?, last_error = ?, last_checked_at = ?, updated_at = ? WHERE id = ?").bind(newStatus, message, now, now, a.id).run();
  await log(c.env, { level: newStatus === a.status ? "warn" : "error", module: "instagram", operation, entityId: a.ig_user_id, code: ge?.kind ?? "token_unusable", message });
  return c.json({ error: { code: ge?.kind ?? "token_unusable", message }, status: await status(c.env, c.req.url) }, 502);
}

export const igAdmin = new Hono<{ Bindings: Env }>();

igAdmin.get("/status", async (c) => c.json(await status(c.env, c.req.url)));

/** Start OAuth: returns the Instagram authorization URL with a single-use state (10 minutes). */
igAdmin.post("/connect", async (c) => {
  const cfg = igConfig(c.env, c.req.url);
  if (cfg.missing.length) return c.json({ error: { code: "instagram_not_configured", message: `Missing configuration: ${cfg.missing.join(", ")}` }, missing: cfg.missing }, 503);
  const state = randomToken(32);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(new Date(Date.now() - 86_400_000).toISOString()),
    c.env.DB.prepare("INSERT INTO oauth_states (state, expires_at) VALUES (?, ?)").bind(state, expiresAt),
  ]);
  const url = cfg.mode === "unified"
    ? unifiedAuthorizeUrl({ appId: c.env.META_APP_ID!.trim(), configId: c.env.FB_LOGIN_CONFIG_ID!.trim(), redirectUri: cfg.redirectUri, state })
    : authorizeUrl({ appId: c.env.IG_APP_ID!.trim(), redirectUri: cfg.redirectUri, state });
  return c.json({ authorizeUrl: url, expiresAt });
});

/** Verify the token works and refresh account details + webhook subscription state. */
igAdmin.post("/check", async (c) => {
  const a = await getAccount(c.env);
  if (!a) return bad(c, "not_connected", "No Instagram account is connected", 404);
  const cfg = igConfig(c.env, c.req.url);
  try {
    const token = await accountToken(c.env, a);
    const p = a.login_mode === "unified"
      ? { ...(await getIgAccount(hostsFor(c.env), token, cfg.version, a.ig_user_id)), accountType: a.account_type ?? null }
      : await getProfile(hostsFor(c.env), token, cfg.version);
    let subscribed: boolean | null = null;
    try { subscribed = (await getSubscribedFields(targetFor(c.env, a), token, cfg.version)).includes("comments"); } catch { /* keep previous value */ }
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      "UPDATE instagram_accounts SET username = ?, account_type = ?, profile_picture_url = ?, status = 'connected', last_error = NULL, last_checked_at = ?, webhooks_subscribed = ?, updated_at = ? WHERE id = ?",
    ).bind(p.username, p.accountType, p.profilePictureUrl, now, subscribed === null ? a.webhooks_subscribed : subscribed ? 1 : 0, now, a.id).run();
    return c.json(await status(c.env, c.req.url));
  } catch (e) {
    return graphFailure(c, a, e, "check");
  }
});

igAdmin.post("/subscribe", async (c) => {
  const a = await getAccount(c.env);
  if (!a) return bad(c, "not_connected", "No Instagram account is connected", 404);
  try {
    await subscribeWebhooks(targetFor(c.env, a), await accountToken(c.env, a), igConfig(c.env, c.req.url).version, ["comments"]);
    const now = new Date().toISOString();
    await c.env.DB.prepare("UPDATE instagram_accounts SET webhooks_subscribed = 1, last_error = NULL, updated_at = ? WHERE id = ?").bind(now, a.id).run();
    await log(c.env, { level: "info", persist: true, module: "instagram", operation: "subscribe_webhooks", entityId: a.ig_user_id, message: "Subscribed to comment webhooks" });
    return c.json(await status(c.env, c.req.url));
  } catch (e) {
    return graphFailure(c, a, e, "subscribe_webhooks");
  }
});

igAdmin.post("/refresh-token", async (c) => {
  const a = await getAccount(c.env);
  if (!a) return bad(c, "not_connected", "No Instagram account is connected", 404);
  if (a.login_mode === "unified") return bad(c, "not_refreshable", a.token_expires_at ? "This token type is renewed by reconnecting Instagram." : "This connection uses a token that doesn't expire; no refresh is needed.", 409);
  try {
    const r = await refreshLongLived(hostsFor(c.env), await accountToken(c.env, a));
    await saveRefreshedToken(c.env, a, r.accessToken, r.expiresIn);
    return c.json(await status(c.env, c.req.url));
  } catch (e) {
    return graphFailure(c, a, e, "refresh_token");
  }
});

export async function saveRefreshedToken(env: Env, a: AccountRow, token: string, expiresIn: number): Promise<void> {
  const now = new Date();
  const expiresAt = expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000).toISOString() : a.token_expires_at;
  await env.DB.prepare("UPDATE instagram_accounts SET access_token_enc = ?, token_expires_at = ?, token_refreshed_at = ?, status = 'connected', last_error = NULL, updated_at = ? WHERE id = ?")
    .bind(await encryptSecret(token, env.TOKEN_ENCRYPTION_KEY!, a.ig_user_id), expiresAt, now.toISOString(), now.toISOString(), a.id).run();
  await log(env, { level: "info", persist: true, module: "instagram", operation: "refresh_token", entityId: a.ig_user_id, message: `Instagram token refreshed; valid until ${expiresAt?.slice(0, 10) ?? "unknown"}` });
}

igAdmin.post("/disconnect", async (c) => {
  const a = await getAccount(c.env);
  if (!a) return bad(c, "not_connected", "No Instagram account is connected", 404);
  let note = "";
  try { await unsubscribeWebhooks(targetFor(c.env, a), await accountToken(c.env, a), igConfig(c.env, c.req.url).version); }
  catch { note = " (could not unsubscribe webhooks on Instagram's side; remove the app in Instagram settings if needed)"; }
  await c.env.DB.prepare("DELETE FROM instagram_accounts WHERE id = ?").bind(a.id).run();
  await log(c.env, { level: "info", persist: true, module: "instagram", operation: "disconnect", entityId: a.ig_user_id, message: `Instagram @${a.username ?? a.ig_user_id} disconnected; stored token deleted${note}` });
  return c.json(await status(c.env, c.req.url));
});

igAdmin.get("/media", async (c) => {
  const a = await getAccount(c.env);
  if (!a) return bad(c, "not_connected", "No Instagram account is connected", 404);
  try {
    const after = c.req.query("after");
    return c.json(await listMedia(targetFor(c.env, a), await accountToken(c.env, a), igConfig(c.env, c.req.url).version, { after: after && /^[A-Za-z0-9_=-]{1,500}$/.test(after) ? after : undefined }));
  } catch (e) {
    return graphFailure(c, a, e, "list_media");
  }
});

igAdmin.get("/events", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1), 200);
  const { results } = await c.env.DB.prepare(
    `SELECT id, event_type, process_status, error, media_id, comment_id, from_username, comment_text, received_at, delivery_count, signature_key
     FROM webhook_events ORDER BY received_at DESC, rowid DESC LIMIT ?`,
  ).bind(limit).all<Record<string, any>>();
  const items: WebhookEventSummary[] = results.map((r) => ({
    id: r.id, eventType: r.event_type, status: r.process_status, error: r.error, mediaId: r.media_id, commentId: r.comment_id,
    fromUsername: r.from_username, text: r.comment_text, receivedAt: r.received_at, deliveryCount: r.delivery_count, signatureKey: r.signature_key,
  }));
  return c.json({ items });
});
