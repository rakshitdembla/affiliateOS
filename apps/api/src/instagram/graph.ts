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

const GRAPH = "https://graph.instagram.com";
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
export async function exchangeCode(o: { appId: string; appSecret: string; redirectUri: string; code: string }) {
  const form = new URLSearchParams({ client_id: o.appId, client_secret: o.appSecret, grant_type: "authorization_code", redirect_uri: o.redirectUri, code: o.code });
  const b = await call("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
  const d = Array.isArray(b?.data) ? b.data[0] : b;
  if (!d?.access_token || d.user_id == null) throw new GraphError("unknown", "Unexpected token response from Instagram");
  const perms: string[] = Array.isArray(d.permissions) ? d.permissions : typeof d.permissions === "string" ? d.permissions.split(",") : [];
  return { accessToken: String(d.access_token), userId: String(d.user_id), permissions: perms.map((p) => p.trim()).filter(Boolean) };
}

/** Short-lived → long-lived (≈60 days). */
export async function exchangeLongLived(appSecret: string, shortToken: string) {
  const b = await call(withParams(`${GRAPH}/access_token`, { grant_type: "ig_exchange_token", client_secret: appSecret, access_token: shortToken }));
  if (!b?.access_token) throw new GraphError("unknown", "Unexpected long-lived token response from Instagram");
  return { accessToken: String(b.access_token), expiresIn: Number(b.expires_in) || 0 };
}

/** Refresh a long-lived token (must be ≥24h old and unexpired); valid for another 60 days. */
export async function refreshLongLived(token: string) {
  const b = await call(withParams(`${GRAPH}/refresh_access_token`, { grant_type: "ig_refresh_token", access_token: token }));
  if (!b?.access_token) throw new GraphError("unknown", "Unexpected refresh response from Instagram");
  return { accessToken: String(b.access_token), expiresIn: Number(b.expires_in) || 0 };
}

export interface Profile { id: string; userId: string | null; username: string | null; accountType: string | null; profilePictureUrl: string | null }

export async function getProfile(token: string, version: string): Promise<Profile> {
  const b = await call(withParams(`${GRAPH}/${version}/me`, { fields: "user_id,username,account_type,profile_picture_url", access_token: token }));
  return {
    id: String(b.id), userId: b.user_id != null ? String(b.user_id) : null, username: b.username ?? null,
    accountType: b.account_type ?? null, profilePictureUrl: b.profile_picture_url ?? null,
  };
}

export async function subscribeWebhooks(token: string, version: string, fields: string[]): Promise<void> {
  const b = await call(withParams(`${GRAPH}/${version}/me/subscribed_apps`, { subscribed_fields: fields.join(","), access_token: token }), { method: "POST" });
  if (b?.success !== true) throw new GraphError("unknown", "Instagram did not confirm the webhook subscription");
}

export async function getSubscribedFields(token: string, version: string): Promise<string[]> {
  const b = await call(withParams(`${GRAPH}/${version}/me/subscribed_apps`, { access_token: token }));
  const fields = new Set<string>();
  for (const app of Array.isArray(b?.data) ? b.data : []) {
    const f = app?.subscribed_fields;
    for (const x of Array.isArray(f) ? f : typeof f === "string" ? f.split(",") : []) fields.add(String(typeof x === "object" ? x?.name : x).trim());
  }
  return [...fields].filter(Boolean);
}

export async function unsubscribeWebhooks(token: string, version: string): Promise<void> {
  await call(withParams(`${GRAPH}/${version}/me/subscribed_apps`, { access_token: token }), { method: "DELETE" });
}

export interface MediaItem { id: string; caption: string | null; mediaType: string | null; mediaProductType: string | null; permalink: string | null; thumbnailUrl: string | null; timestamp: string | null }

export async function listMedia(token: string, version: string, o: { after?: string; limit?: number } = {}) {
  const b = await call(withParams(`${GRAPH}/${version}/me/media`, {
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
