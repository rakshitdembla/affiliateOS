import type { InstagramAccount } from "@affiliateos/shared";
import type { Env } from "../env";
import { decryptSecret } from "../crypto";

export type AccountRow = Record<string, any>;

export const getAccount = (env: Env) =>
  env.DB.prepare("SELECT * FROM instagram_accounts ORDER BY connected_at DESC LIMIT 1").first<AccountRow>();

/** Decrypts the stored token. The ciphertext is bound to the account's Instagram user id. */
export const accountToken = (env: Env, a: AccountRow): Promise<string> =>
  decryptSecret(a.access_token_enc, env.TOKEN_ENCRYPTION_KEY!, a.ig_user_id);

/** Public view of the account. Never includes the token. */
export const toAccount = (a: AccountRow): InstagramAccount => ({
  igUserId: a.ig_user_id,
  username: a.username ?? null,
  accountType: a.account_type ?? null,
  profilePictureUrl: a.profile_picture_url ?? null,
  status: a.status,
  scopes: a.scopes ? String(a.scopes).split(",").filter(Boolean) : [],
  tokenExpiresAt: a.token_expires_at ?? null,
  tokenRefreshedAt: a.token_refreshed_at ?? null,
  webhooksSubscribed: !!a.webhooks_subscribed,
  lastCheckedAt: a.last_checked_at ?? null,
  lastError: a.last_error ?? null,
  connectedAt: a.connected_at,
});
