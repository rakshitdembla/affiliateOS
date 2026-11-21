import type { Env } from "./env";
import { isValidEncryptionKey } from "./crypto";
import { log } from "./logger";
import { accountToken } from "./instagram/account";
import { saveRefreshedToken } from "./instagram/admin";
import { GraphError, hostsFor, refreshLongLived } from "./instagram/graph";
import { recoverStaleJobs } from "./queue/engine";
import { ingestEvents } from "./queue/ingest";
import { applyRetention, backupToR2, setState } from "./system";

const DAY = 86_400_000;
/** Refresh when fewer than this many days remain (long-lived tokens last ~60 days and must be ≥24h old to refresh). */
const REFRESH_WITHIN_DAYS = 20;

export async function refreshDueTokens(env: Env, now = new Date()): Promise<{ checked: number; refreshed: number; failed: number }> {
  const out = { checked: 0, refreshed: 0, failed: 0 };
  if (!isValidEncryptionKey(env.TOKEN_ENCRYPTION_KEY)) return out;
  const { results } = await env.DB.prepare("SELECT * FROM instagram_accounts WHERE status = 'connected'").all<Record<string, any>>();
  for (const a of results) {
    if (a.login_mode === "unified" && !a.token_expires_at) continue; // non-expiring system-user token
    out.checked++;
    const expires = a.token_expires_at ? Date.parse(a.token_expires_at) : NaN;
    const issued = Date.parse(a.token_refreshed_at ?? a.connected_at);
    if (Number.isFinite(expires) && expires <= now.getTime()) {
      await env.DB.prepare("UPDATE instagram_accounts SET status = 'expired', last_error = ?, updated_at = ? WHERE id = ?").bind("Access token expired. Reconnect Instagram.", now.toISOString(), a.id).run();
      await log(env, { level: "error", module: "instagram", operation: "refresh_token", entityId: a.ig_user_id, code: "token_expired", message: "Instagram access token expired before it could be refreshed; reconnect Instagram" });
      out.failed++;
      continue;
    }
    if (a.login_mode === "unified") continue; // expiring Unified tokens are renewed by reconnecting (warned in System health)
    const due = !Number.isFinite(expires) || expires - now.getTime() < REFRESH_WITHIN_DAYS * DAY;
    if (!due || now.getTime() - issued < DAY) continue;
    try {
      const r = await refreshLongLived(hostsFor(env), await accountToken(env, a));
      await saveRefreshedToken(env, a, r.accessToken, r.expiresIn);
      out.refreshed++;
    } catch (e) {
      out.failed++;
      const ge = e instanceof GraphError ? e : null;
      const invalid = ge?.kind === "token_invalid";
      await env.DB.prepare("UPDATE instagram_accounts SET status = ?, last_error = ?, updated_at = ? WHERE id = ?")
        .bind(invalid ? "expired" : a.status, `Token refresh failed: ${ge?.message ?? "token could not be decrypted"}`, now.toISOString(), a.id).run();
      await log(env, { level: invalid ? "error" : "warn", module: "instagram", operation: "refresh_token", entityId: a.ig_user_id, code: ge?.kind ?? "token_unusable", message: `Scheduled token refresh failed: ${ge?.message ?? "token could not be decrypted"}` });
    }
  }
  return out;
}

/** Daily maintenance. Each step is isolated so one failure can't stop the others; failures are logged as errors. */
export async function runScheduled(env: Env): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ["refresh_tokens", () => refreshDueTokens(env)],
    ["recover_jobs", () => recoverStaleJobs(env)],
    ["ingest", async () => { if (env.PUBLIC_BASE_URL) await ingestEvents(env, env.PUBLIC_BASE_URL.replace(/\/+$/, "")); }],
    ["retention", () => applyRetention(env)],
    ["backup", () => backupToR2(env)],
  ];
  for (const [name, fn] of steps) {
    try { await fn(); } catch (e) {
      await log(env, { level: "error", module: "system", operation: `cron_${name}`, code: "cron_step_failed", message: `Daily maintenance step "${name}" failed: ${(e as Error).message}` });
    }
  }
  await setState(env, "last_cron", new Date().toISOString());
  await env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(new Date(Date.now() - DAY).toISOString()).run();
}
