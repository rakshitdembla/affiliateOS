import { Hono, type Context } from "hono";
import type { Env } from "../env";
import { b64urlDecode, hmacSha256, quoteBigInts, randomToken, timingSafeEqualBytes } from "../crypto";
import { log } from "../logger";
import { esc, renderMessagePage } from "../storefront-render";
import { igConfig, webhookSecrets } from "./config";

/** Verify a Meta `signed_request` (HMAC-SHA256 over the base64url payload). Returns the payload or null. */
export async function parseSignedRequest(signed: string, secrets: string[]): Promise<Record<string, any> | null> {
  const [sigPart, payloadPart] = signed.split(".", 2);
  if (!sigPart || !payloadPart) return null;
  try {
    const sig = b64urlDecode(sigPart);
    for (const secret of secrets) {
      if (!timingSafeEqualBytes(await hmacSha256(secret, payloadPart), sig)) continue;
      const data = JSON.parse(quoteBigInts(new TextDecoder().decode(b64urlDecode(payloadPart))));
      return String(data?.algorithm ?? "").toUpperCase() === "HMAC-SHA256" ? data : null;
    }
  } catch { /* invalid encoding */ }
  return null;
}

async function signedUserId(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
  const signed = typeof form.signed_request === "string" ? form.signed_request : "";
  const data = signed ? await parseSignedRequest(signed, webhookSecrets(c.env).map(([, s]) => s)) : null;
  return data?.user_id != null ? String(data.user_id) : null;
}

const htmlHeaders = { "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer" };

export const compliance = new Hono<{ Bindings: Env }>();

/** Meta calls this when the user removes the app from their Instagram account. */
compliance.post("/oauth/instagram/deauthorize", async (c) => {
  const userId = await signedUserId(c);
  if (!userId) return c.json({ error: { code: "invalid_signed_request", message: "Invalid signed_request" } }, 400);
  const r = await c.env.DB.prepare("DELETE FROM instagram_accounts WHERE ig_user_id = ? OR app_scoped_id = ?").bind(userId, userId).run();
  await log(c.env, { level: "warn", module: "instagram", operation: "deauthorize", code: "app_removed", message: `Instagram app access was removed by the account owner; ${r.meta.changes} stored account(s) and token(s) deleted` });
  return c.json({ success: true });
});

/** Meta's data deletion callback: delete the account's stored data and return a status URL + confirmation code. */
compliance.post("/oauth/instagram/data-deletion", async (c) => {
  const userId = await signedUserId(c);
  if (!userId) return c.json({ error: { code: "invalid_signed_request", message: "Invalid signed_request" } }, 400);
  const code = randomToken(12);
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM instagram_accounts WHERE ig_user_id = ? OR app_scoped_id = ?").bind(userId, userId),
    c.env.DB.prepare("INSERT INTO data_deletion_requests (code, requested_at, completed_at) VALUES (?, ?, ?)").bind(code, now, now),
  ]);
  await log(c.env, { level: "warn", module: "instagram", operation: "data_deletion", entityId: code, code: "data_deletion", message: "Data deletion request processed; stored Instagram account data deleted" });
  return c.json({ url: `${igConfig(c.env, c.req.url).base}/oauth/instagram/deletion-status?code=${code}`, confirmation_code: code });
});

compliance.get("/oauth/instagram/deletion-status", async (c) => {
  const code = c.req.query("code") ?? "";
  const row = /^[A-Za-z0-9_-]{8,40}$/.test(code) ? await c.env.DB.prepare("SELECT completed_at FROM data_deletion_requests WHERE code = ?").bind(code).first<{ completed_at: string | null }>() : null;
  if (!row) return c.html(renderMessagePage("Request not found", "No data deletion request matches this confirmation code."), 404, htmlHeaders);
  return c.html(renderMessagePage("Data deleted", `Deletion request ${code} was completed on ${row.completed_at?.slice(0, 10) ?? "—"}. The connected Instagram account and its access token were removed.`), 200, htmlHeaders);
});

compliance.get("/privacy", (c) => {
  const cfg = igConfig(c.env, c.req.url);
  const contact = c.env.PRIVACY_CONTACT || "a direct message to the Instagram account that operates this service";
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privacy Policy</title>
<style>body{margin:0;background:#fff;color:#1c1917;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}main{max-width:720px;margin:0 auto;padding:48px 20px}h1{font:400 34px/1.2 Georgia,serif}h2{font-size:18px;margin-top:32px}li{margin:6px 0}small{color:#78716c}</style></head><body><main>
<h1>Privacy Policy</h1><small>Last updated: 2026-11-20</small>
<p>This service ("AffiliateOS") is a private tool operated by a single Instagram creator to share shopping links. It is not offered to other businesses.</p>
<h2>What we collect</h2><ul>
<li><b>The operator's Instagram professional account</b>: account ID, username, account type, profile picture URL and an access token (encrypted at rest), obtained through Instagram's official login.</li>
<li><b>Comments on the operator's posts and reels</b>, delivered by Instagram webhooks: comment ID, commenter's Instagram-scoped ID and username, comment text and post ID. These are used only to send the commenter the link they asked for, through Instagram's official private-reply feature.</li>
<li><b>Link clicks and page views</b> on collection pages: time, product, collection, a traffic-source label and whether the visitor looked like an automated crawler. No names, IP addresses or advertising identifiers are stored.</li></ul>
<h2>How it is used</h2><p>Only to run the service: showing collections, redirecting to retailers, replying to comments that ask for a link, and counting clicks. Data is not sold, shared with advertisers or used for profiling.</p>
<h2>Where it is stored</h2><p>On Cloudflare's infrastructure (Workers, D1, R2), operated by the account owner.</p>
<h2>Retention and deletion</h2><p>Raw comment events are deleted after 90 days; the text of comments attached to reply records is erased after 180 days; system logs are deleted after 90 days. Encrypted daily backups of the database are kept for 14 days. Removing the app from your Instagram settings, or sending a data deletion request through Instagram, deletes the stored account data and token. Data deletion callback: <code>${esc(cfg.dataDeletionUrl)}</code>.</p>
<h2>Contact</h2><p>Questions or deletion requests: ${esc(contact)}.</p>
</main></body></html>`;
  return c.html(body, 200, { ...htmlHeaders, "Cache-Control": "public, max-age=3600" });
});
