import { Hono, type Context } from "hono";
import type { Env } from "../env";
import { encryptSecret } from "../crypto";
import { log, logThrottled } from "../logger";
import { renderMessagePage } from "../storefront-render";
import { igConfig } from "./config";
import { exchangeCode, exchangeLongLived, getProfile, GraphError, subscribeWebhooks } from "./graph";

const STATE_RE = /^[A-Za-z0-9_-]{20,100}$/;

const page = (c: Context, title: string, message: string, status: 200 | 400 | 502 | 503 = 200) =>
  c.html(renderMessagePage(title, message), status, {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
  });

export const oauthPublic = new Hono<{ Bindings: Env }>();

/** Instagram redirects here after the user approves (or cancels) in the browser. */
oauthPublic.get("/oauth/instagram/callback", async (c) => {
  const env = c.env;
  const cfg = igConfig(env, c.req.url);
  const now = new Date().toISOString();
  const state = c.req.query("state") ?? "";

  // Consume the state exactly once (atomic): unknown, expired or reused states are rejected.
  const consumed = STATE_RE.test(state)
    ? await env.DB.prepare("UPDATE oauth_states SET used_at = ? WHERE state = ? AND used_at IS NULL AND expires_at > ?").bind(now, state, now).run()
    : null;
  if (!consumed || consumed.meta.changes !== 1) {
    await logThrottled(env, { level: "warn", module: "instagram", operation: "oauth_callback", code: "invalid_state", message: "OAuth callback with an unknown, expired or already-used state" });
    return page(c, "Link expired", "This sign-in link has expired or was already used. Start again from AffiliateOS → Instagram.", 400);
  }

  if (c.req.query("error")) {
    await log(env, { level: "info", persist: true, module: "instagram", operation: "oauth_callback", code: c.req.query("error_reason") ?? "denied", message: "Instagram connection was cancelled in the browser" });
    return page(c, "Connection cancelled", "Instagram access was not granted. You can close this tab and try again from AffiliateOS.");
  }

  const code = (c.req.query("code") ?? "").replace(/#_$/, "");
  if (!code) return page(c, "Connection failed", "Instagram did not return an authorization code. Start again from AffiliateOS.", 400);
  if (cfg.missing.length) return page(c, "Not configured", "The server is missing Instagram configuration. See the Instagram page in AffiliateOS.", 503);

  try {
    const short = await exchangeCode({ appId: env.IG_APP_ID!.trim(), appSecret: env.IG_APP_SECRET!, redirectUri: cfg.redirectUri, code });
    const long = await exchangeLongLived(env.IG_APP_SECRET!, short.accessToken);
    const profile = await getProfile(long.accessToken, cfg.version);
    const igUserId = profile.userId ?? short.userId;
    const tokenEnc = await encryptSecret(long.accessToken, env.TOKEN_ENCRYPTION_KEY!, igUserId);
    const expiresAt = long.expiresIn > 0 ? new Date(Date.now() + long.expiresIn * 1000).toISOString() : null;

    let subscribed = 0;
    let lastError: string | null = null;
    try {
      await subscribeWebhooks(long.accessToken, cfg.version, ["comments"]);
      subscribed = 1;
    } catch (e) {
      lastError = `Webhook subscription failed: ${(e as Error).message}`;
    }

    const replaced = await env.DB.prepare("SELECT username FROM instagram_accounts WHERE ig_user_id != ?").bind(igUserId).all<{ username: string | null }>();
    await env.DB.batch([
      // Single-account app: connecting a different account replaces the previous one.
      env.DB.prepare("DELETE FROM instagram_accounts WHERE ig_user_id != ?").bind(igUserId),
      env.DB.prepare(
        `INSERT INTO instagram_accounts (id, ig_user_id, app_scoped_id, username, account_type, profile_picture_url, access_token_enc,
           token_expires_at, token_refreshed_at, scopes, status, webhooks_subscribed, last_error, last_checked_at, connected_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,'connected',?,?,?,?,?)
         ON CONFLICT(ig_user_id) DO UPDATE SET app_scoped_id=excluded.app_scoped_id, username=excluded.username, account_type=excluded.account_type,
           profile_picture_url=excluded.profile_picture_url, access_token_enc=excluded.access_token_enc, token_expires_at=excluded.token_expires_at,
           token_refreshed_at=excluded.token_refreshed_at, scopes=excluded.scopes, status='connected', webhooks_subscribed=excluded.webhooks_subscribed,
           last_error=excluded.last_error, last_checked_at=excluded.last_checked_at, connected_at=excluded.connected_at, updated_at=excluded.updated_at`,
      ).bind(crypto.randomUUID(), igUserId, profile.id, profile.username, profile.accountType, profile.profilePictureUrl, tokenEnc, expiresAt, now,
        short.permissions.join(","), subscribed, lastError, now, now, now),
    ]);

    const who = `@${profile.username ?? igUserId}`;
    await log(env, { level: "info", persist: true, module: "instagram", operation: "connect", entityId: igUserId, message: `Instagram connected as ${who}` + (replaced.results.length ? ` (replaced ${replaced.results.map((r) => `@${r.username}`).join(", ")})` : "") });
    if (lastError) await log(env, { level: "warn", module: "instagram", operation: "subscribe_webhooks", entityId: igUserId, code: "subscribe_failed", message: lastError });
    return page(c, "Instagram connected", `Connected as ${who}. You can close this tab and return to AffiliateOS.` + (lastError ? " Note: the webhook subscription needs attention — see the Instagram page." : ""));
  } catch (e) {
    const ge = e instanceof GraphError ? e : null;
    await log(env, { level: "error", module: "instagram", operation: "oauth_exchange", code: ge?.kind ?? "unexpected", message: ge?.message ?? String((e as Error)?.message ?? e) });
    return page(c, "Connection failed", `Instagram rejected the connection${ge ? `: ${ge.message}` : ""}. Start again from AffiliateOS.`, 502);
  }
});
