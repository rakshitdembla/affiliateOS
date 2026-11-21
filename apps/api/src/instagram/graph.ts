import { quoteBigInts } from "../crypto";
import { sanitize } from "../logger";

/**
 * Minimal client for the official Instagram API with Instagram Login (graph.instagram.com).
 * Endpoints per Meta's "Business Login for Instagram" and webhook docs. Tokens are never logged.
 */
export type GraphErrorKind = "token_invalid" | "permission_missing" | "rate_limited" | "temporary" | "invalid_request" | "network" | "unknown";

export class GraphError extends Error {
  constructor(
    public kind: GraphErrorKind,
    message: string,
    public status: number | null = null,
    public code: number | null = null,
    public subcode: number | null = null,
  ) { super(message); }
  get retryable(): boolean { return this.kind === "rate_limited" || this.kind === "temporary" || this.kind === "network"; }
}

const RATE_CODES = new Set([4, 17, 32, 613]);

export function classifyGraphError(status: number, err: any): GraphError {
  const code = err?.code != null && Number.isFinite(Number(err.code)) ? Number(err.code) : null;
  const sub = err?.error_subcode != null && Number.isFinite(Number(err.error_subcode)) ? Number(err.error_subcode) : null;
  const message = sanitize(String(err?.message ?? err?.error_message ?? `Instagram returned HTTP ${status}`));
  let kind: GraphErrorKind = "unknown";
  if (code === 190 || code === 102 || code === 463 || code === 467 || sub === 463 || sub === 467 || status === 401) kind = "token_invalid";
  else if (code === 10 || (code !== null && code >= 200 && code <= 299) || status === 403) kind = "permission_missing";
  else if ((code !== null && (RATE_CODES.has(code) || (code >= 80001 && code <= 80014))) || status === 429) kind = "rate_limited";
  else if (code === 1 || code === 2 || status >= 500) kind = "temporary";
  else if (code === 100 || status === 400) kind = "invalid_request";
  return new GraphError(kind, message, status, code, sub);
}

async function call<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new GraphError("network", "Could not reach Instagram (network error or timeout)");
  }
  const text = await res.text().catch(() => "");
  let body: any = null;
  try { body = text ? JSON.parse(quoteBigInts(text)) : null; } catch { /* non-JSON */ }
  if (!res.ok || body?.error || body?.error_type) throw classifyGraphError(res.status, body?.error ?? body);
  if (body === null) throw new GraphError("unknown", `Unexpected response from Instagram (HTTP ${res.status})`, res.status);
  return body as T;
}

export interface Hosts { graph: string; oauth: string; fb: string }
export const OFFICIAL_HOSTS: Hosts = { graph: "https://graph.instagram.com", oauth: "https://api.instagram.com", fb: "https://graph.facebook.com" };
/** Where account-level calls go: Instagram Login → graph.instagram.com/…/me; Unified login → graph.facebook.com/…/<IG account id>. */
export interface Target { host: string; node: string }

/**
 * Test seam for end-to-end tests: IG_GRAPH_BASE may point at a local mock, but only loopback URLs are honoured,
 * so a misconfiguration can never send tokens or messages anywhere except Meta's official hosts.
 */
export function hostsFor(env: { IG_GRAPH_BASE?: string }): Hosts {
  const o = env.IG_GRAPH_BASE?.trim().replace(/\/+$/, "");
  return o && /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(o) ? { graph: o, oauth: o, fb: o } : OFFICIAL_HOSTS;
}
const withParams = (base: string, params: Record<string, string | undefined>): string => {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
};

export const SCOPES = ["instagram_business_basic", "instagram_business_manage_comments", "instagram_business_manage_messages"];

export function authorizeUrl(o: { appId: string; redirectUri: string; state: string }): string {
  return withParams("https://www.instagram.com/oauth/authorize", {
    client_id: o.appId, redirect_uri: o.redirectUri, response_type: "code", scope: SCOPES.join(","), state: o.state, force_reauth: "true",
  });
}

/** Authorization code → short-lived token. Response may be wrapped in `data: [...]`. */
export async function exchangeCode(h: Hosts, o: { appId: string; appSecret: string; redirectUri: string; code: string }) {
  const form = new URLSearchParams({ client_id: o.appId, client_secret: o.appSecret, grant_type: "authorization_code", redirect_uri: o.redirectUri, code: o.code });
  const b = await call(`${h.oauth}/oauth/access_token`, { method: "POST", body: form });
  const d = Array.isArray(b?.data) ? b.data[0] : b;
  if (!d?.access_token || d.user_id == null) throw new GraphError("unknown", "Unexpected token response from Instagram");
  const perms: string[] = Array.isArray(d.permissions) ? d.permissions : typeof d.permissions === "string" ? d.permissions.split(",") : [];
  return { accessToken: String(d.access_token), userId: String(d.user_id), permissions: perms.map((p) => p.trim()).filter(Boolean) };
}

/** Short-lived → long-lived (≈60 days). */
export async function exchangeLongLived(h: Hosts, appSecret: string, shortToken: string) {
  const b = await call(withParams(`${h.graph}/access_token`, { grant_type: "ig_exchange_token", client_secret: appSecret, access_token: shortToken }));
  if (!b?.access_token) throw new GraphError("unknown", "Unexpected long-lived token response from Instagram");
  return { accessToken: String(b.access_token), expiresIn: Number(b.expires_in) || 0 };
}

/** Refresh a long-lived token (must be ≥24h old and unexpired); valid for another 60 days. */
export async function refreshLongLived(h: Hosts, token: string) {
  const b = await call(withParams(`${h.graph}/refresh_access_token`, { grant_type: "ig_refresh_token", access_token: token }));
  if (!b?.access_token) throw new GraphError("unknown", "Unexpected refresh response from Instagram");
  return { accessToken: String(b.access_token), expiresIn: Number(b.expires_in) || 0 };
}

export interface Profile { id: string; userId: string | null; username: string | null; accountType: string | null; profilePictureUrl: string | null }

export async function getProfile(h: Hosts, token: string, version: string): Promise<Profile> {
  const b = await call(withParams(`${h.graph}/${version}/me`, { fields: "user_id,username,account_type,profile_picture_url", access_token: token }));
  return {
    id: String(b.id), userId: b.user_id != null ? String(b.user_id) : null, username: b.username ?? null,
    accountType: b.account_type ?? null, profilePictureUrl: b.profile_picture_url ?? null,
  };
}

export async function subscribeWebhooks(t: Target, token: string, version: string, fields: string[]): Promise<void> {
  const b = await call(withParams(`${t.host}/${version}/${t.node}/subscribed_apps`, { subscribed_fields: fields.join(","), access_token: token }), { method: "POST" });
  if (b?.success !== true) throw new GraphError("unknown", "Instagram did not confirm the webhook subscription");
}

export async function getSubscribedFields(t: Target, token: string, version: string): Promise<string[]> {
  const b = await call(withParams(`${t.host}/${version}/${t.node}/subscribed_apps`, { access_token: token }));
  const fields = new Set<string>();
  for (const app of Array.isArray(b?.data) ? b.data : []) {
    const f = app?.subscribed_fields;
    for (const x of Array.isArray(f) ? f : typeof f === "string" ? f.split(",") : []) fields.add(String(typeof x === "object" ? x?.name : x).trim());
  }
  return [...fields].filter(Boolean);
}

export async function unsubscribeWebhooks(t: Target, token: string, version: string): Promise<void> {
  await call(withParams(`${t.host}/${version}/${t.node}/subscribed_apps`, { access_token: token }), { method: "DELETE" });
}

export interface MediaItem { id: string; caption: string | null; mediaType: string | null; mediaProductType: string | null; permalink: string | null; thumbnailUrl: string | null; timestamp: string | null }

export async function listMedia(t: Target, token: string, version: string, o: { after?: string; limit?: number } = {}) {
  const b = await call(withParams(`${t.host}/${version}/${t.node}/media`, {
    fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp",
    limit: String(Math.min(Math.max(o.limit ?? 24, 1), 50)), after: o.after, access_token: token,
  }));
  const items: MediaItem[] = (Array.isArray(b?.data) ? b.data : []).map((m: any) => ({
    id: String(m.id), caption: typeof m.caption === "string" ? m.caption.slice(0, 500) : null, mediaType: m.media_type ?? null,
    mediaProductType: m.media_product_type ?? null, permalink: m.permalink ?? null,
    thumbnailUrl: m.thumbnail_url ?? (m.media_type === "IMAGE" ? m.media_url ?? null : null), timestamp: m.timestamp ?? null,
  }));
  return { items, after: (b?.paging?.next && b?.paging?.cursors?.after) ? String(b.paging.cursors.after) : null };
}

export type SendResult =
  | { kind: "sent"; messageId: string; recipientId: string | null; status: number }
  /** No definite answer from Instagram: the reply may or may not have been delivered. Never retried blindly. */
  | { kind: "uncertain"; reason: string; status: number | null }
  /** Instagram answered with an explicit error: the message was not sent. */
  | { kind: "rejected"; error: GraphError; retryAfterSeconds: number | null };

/** Max "estimated_time_to_regain_access" (minutes) from X-Business-Use-Case-Usage, in seconds. */
function regainSeconds(res: Response): number | null {
  try {
    const v = JSON.parse(res.headers.get("x-business-use-case-usage") ?? "null");
    let max = 0;
    for (const arr of Object.values(v ?? {})) for (const u of (arr as any[]) ?? []) max = Math.max(max, Number(u?.estimated_time_to_regain_access) || 0);
    return max > 0 ? max * 60 : null;
  } catch { return null; }
}

/** Private reply to a comment (Meta: POST /<IG_ID>/messages with recipient.comment_id; one reply per comment, within 7 days). */
export async function sendPrivateReply(t: Target, o: { token: string; version: string; igUserId: string; commentId: string; text: string; timeoutMs?: number }): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch(`${t.host}/${o.version}/${encodeURIComponent(o.igUserId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${o.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { comment_id: o.commentId }, message: { text: o.text } }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
    });
  } catch {
    return { kind: "uncertain", reason: "No response from Instagram (network error or timeout). The reply may or may not have been delivered.", status: null };
  }
  const raw = await res.text().catch(() => "");
  let body: any = null;
  try { body = raw ? JSON.parse(quoteBigInts(raw)) : null; } catch { /* non-JSON */ }
  if (res.ok && body?.message_id) return { kind: "sent", messageId: String(body.message_id), recipientId: body.recipient_id != null ? String(body.recipient_id) : null, status: res.status };
  if (body?.error) return { kind: "rejected", error: classifyGraphError(res.status, body.error), retryAfterSeconds: regainSeconds(res) };
  return { kind: "uncertain", reason: `Unexpected response from Instagram (HTTP ${res.status}). The reply may or may not have been delivered.`, status: res.status };
}

export interface ConversationMessage { id: string; createdTime: number | null; fromId: string | null; fromUsername: string | null; text: string | null }

/**
 * Conversations API (Meta): find the conversation with a person by Instagram-scoped id, then read recent messages.
 * Only the 20 most recent messages' details are available. Used to check whether an uncertain reply was delivered.
 */
export async function recentMessagesWith(t: Target, o: { token: string; version: string; userId: string; since: number }): Promise<{ messages: ConversationMessage[]; truncated: boolean } | "no_conversation"> {
  const conv = await call(withParams(`${t.host}/${o.version}/${t.node}/conversations`, { platform: "instagram", user_id: o.userId, access_token: o.token }));
  const convId = Array.isArray(conv?.data) && conv.data[0]?.id ? String(conv.data[0].id) : null;
  if (!convId) return "no_conversation";
  const list = await call(withParams(`${t.host}/${o.version}/${encodeURIComponent(convId)}`, { fields: "messages", access_token: o.token }));
  const toTime = (t: unknown): number | null => (t == null ? null : /^\d+$/.test(String(t)) ? Number(t) * 1000 : Date.parse(String(t)) || null);
  const recent = (Array.isArray(list?.messages?.data) ? list.messages.data : [])
    .map((m: any) => ({ id: String(m.id), t: toTime(m.created_time) }))
    .filter((m: { t: number | null }) => m.t === null || m.t >= o.since);
  const ids = recent.slice(0, 20);
  const out: ConversationMessage[] = [];
  for (const m of ids) {
    const d = await call(withParams(`${t.host}/${o.version}/${encodeURIComponent(m.id)}`, { fields: "id,created_time,from,to,message", access_token: o.token }));
    out.push({ id: String(d.id ?? m.id), createdTime: toTime(d.created_time) ?? m.t, fromId: d.from?.id != null ? String(d.from.id) : null, fromUsername: d.from?.username ?? null, text: typeof d.message === "string" ? d.message : null });
    await new Promise((r) => setTimeout(r, 500)); // Conversations API: 2 calls/second per account
  }
  return { messages: out, truncated: recent.length > 20 };
}

// ---------------- Unified login (Facebook Login for Business) ----------------
export const UNIFIED_SCOPES = ["instagram_basic", "instagram_manage_comments", "instagram_manage_messages"];

/** Facebook Login for Business dialog for a login configuration (config_id defines permissions, assets and token type). */
export function unifiedAuthorizeUrl(o: { appId: string; configId: string; redirectUri: string; state: string }): string {
  return withParams("https://www.facebook.com/dialog/oauth", {
    client_id: o.appId, config_id: o.configId, redirect_uri: o.redirectUri, response_type: "code", state: o.state,
  });
}

/** Code → Business Integration System User access token (graph.facebook.com, Meta app id/secret). */
export async function exchangeCodeUnified(h: Hosts, o: { appId: string; appSecret: string; redirectUri: string; code: string; version: string }) {
  const b = await call(withParams(`${h.fb}/${o.version}/oauth/access_token`, { client_id: o.appId, client_secret: o.appSecret, redirect_uri: o.redirectUri, code: o.code }));
  if (!b?.access_token) throw new GraphError("unknown", "Unexpected token response from Meta");
  const expiresIn = Number(b.expires_in) || 0;
  return { accessToken: String(b.access_token), expiresIn };
}

export interface IgAccount { id: string; username: string | null; profilePictureUrl: string | null }

/** Instagram professional accounts the login shared with the app (Unified login: /me is the system user, not the account). */
export async function assignedInstagramAccounts(h: Hosts, token: string, version: string): Promise<IgAccount[]> {
  let b: any;
  try { b = await call(withParams(`${h.fb}/${version}/me/assigned_instagram_accounts`, { fields: "id,username,profile_picture_url", access_token: token })); }
  catch (e) {
    if (!(e instanceof GraphError) || e.kind !== "invalid_request") throw e;
    b = await call(withParams(`${h.fb}/${version}/me/assigned_instagram_accounts`, { access_token: token })); // field list not supported here
  }
  return (Array.isArray(b?.data) ? b.data : []).filter((a: any) => a?.id != null).map((a: any) => ({ id: String(a.id), username: a.username ?? null, profilePictureUrl: a.profile_picture_url ?? null }));
}

export async function getIgAccount(h: Hosts, token: string, version: string, igId: string): Promise<IgAccount> {
  const b = await call(withParams(`${h.fb}/${version}/${encodeURIComponent(igId)}`, { fields: "id,username,profile_picture_url", access_token: token }));
  return { id: String(b.id ?? igId), username: b.username ?? null, profilePictureUrl: b.profile_picture_url ?? null };
}

/** Read-only: latest comments on one of the account's posts (exercises instagram_manage_comments). */
export async function mediaComments(t: Target, token: string, version: string, mediaId: string) {
  const b = await call(withParams(`${t.host}/${version}/${encodeURIComponent(mediaId)}/comments`, { fields: "id,timestamp", limit: "1", access_token: token }));
  return Array.isArray(b?.data) ? b.data.length : 0;
}

/** Read-only: conversation list (exercises instagram_manage_messages). Sends nothing. */
export async function listConversations(t: Target, token: string, version: string) {
  const b = await call(withParams(`${t.host}/${version}/${t.node}/conversations`, { platform: "instagram", limit: "1", access_token: token }));
  return Array.isArray(b?.data) ? b.data.length : 0;
}
