import type { Env } from "../env";
import { isValidEncryptionKey } from "../crypto";

export function igConfig(env: Env, requestUrl: string) {
  const base = (env.PUBLIC_BASE_URL || new URL(requestUrl).origin).replace(/\/+$/, "");
  const mode: "unified" | "instagram" = env.IG_LOGIN_MODE === "unified" ? "unified" : "instagram";
  const missing: string[] = [];
  if (mode === "unified") {
    if (!env.META_APP_ID?.trim()) missing.push("META_APP_ID");
    if (!env.FB_LOGIN_CONFIG_ID?.trim()) missing.push("FB_LOGIN_CONFIG_ID");
    if (!env.META_APP_SECRET) missing.push("META_APP_SECRET");
  } else {
    if (!env.IG_APP_ID?.trim()) missing.push("IG_APP_ID");
    if (!env.IG_APP_SECRET) missing.push("IG_APP_SECRET");
  }
  if (!isValidEncryptionKey(env.TOKEN_ENCRYPTION_KEY)) missing.push("TOKEN_ENCRYPTION_KEY");
  if (!env.IG_WEBHOOK_VERIFY_TOKEN) missing.push("IG_WEBHOOK_VERIFY_TOKEN");
  return {
    mode,
    base,
    version: env.IG_GRAPH_VERSION || "v27.0",
    redirectUri: `${base}/oauth/instagram/callback`,
    webhookUrl: `${base}/webhooks/instagram`,
    privacyUrl: `${base}/privacy`,
    deauthorizeUrl: `${base}/oauth/instagram/deauthorize`,
    dataDeletionUrl: `${base}/oauth/instagram/data-deletion`,
    missing,
  };
}

/** Webhook payloads are signed with an app secret; accept the Instagram app secret and, if configured, the Meta app secret. */
export const webhookSecrets = (env: Env): [string, string][] =>
  ([["instagram", env.IG_APP_SECRET], ["meta", env.META_APP_SECRET]] as [string, string | undefined][]).filter((x): x is [string, string] => !!x[1]);
