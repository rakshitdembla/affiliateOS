# Deployment

**Deployed (Phase 1):** https://affiliateos-api.rakshitdembla.workers.dev — D1 `affiliateos` and R2 `affiliateos-images` created, migrations 0001–0003 applied remotely, `ADMIN_API_TOKEN` set as a Worker secret.

To reproduce on a new account (requires `wrangler login`):

1. `wrangler d1 create affiliateos` → put the `database_id` in `apps/api/wrangler.jsonc`.
2. `wrangler r2 bucket create affiliateos-images`.
3. `pnpm --filter @affiliateos/api db:migrate:remote`.
4. `wrangler secret put ADMIN_API_TOKEN` (use a long random value).
5. `pnpm --filter @affiliateos/api deploy`, then verify `GET /health` on the workers.dev URL.
6. Desktop: `pnpm --filter @affiliateos/desktop tauri build` → `src-tauri/target/release/bundle/`.
   The CSP allows only the deployed Worker hostname; update `tauri.conf.json` if it changes.

## Instagram setup (Phase 4)

Already done on the server: migration `0005`, Worker secrets `TOKEN_ENCRYPTION_KEY` and `IG_WEBHOOK_VERIFY_TOKEN` (generated, never displayed), daily token-refresh cron (`17 3 * * *` UTC).

Requirements: an Instagram **professional** account (Business or Creator). Comment webhooks are only delivered for **public** accounts.

1. https://developers.facebook.com/apps → **Create app** → use case **"Manage messaging & content on Instagram"** → name it (e.g. AffiliateOS).
2. In the app: **Instagram → API setup with Instagram login**.
   - Copy the **Instagram app ID** (public, not a secret) → it goes into `IG_APP_ID` in `apps/api/wrangler.jsonc`.
   - **Instagram app secret** → in your own terminal: `cd apps/api && pnpm exec wrangler secret put IG_APP_SECRET`, paste, Enter. Never paste it into chat or files.
3. **Set up Instagram business login → Business login settings**:
   - OAuth redirect URI: `https://affiliateos-api.rakshitdembla.workers.dev/oauth/instagram/callback` (no trailing slash)
   - Deauthorize callback URL: `https://affiliateos-api.rakshitdembla.workers.dev/oauth/instagram/deauthorize`
   - Data deletion request URL: `https://affiliateos-api.rakshitdembla.workers.dev/oauth/instagram/data-deletion`
4. **Configure webhooks**: callback URL `https://affiliateos-api.rakshitdembla.workers.dev/webhooks/instagram`; verify token: run
   `security find-generic-password -s com.affiliateos.setup -a ig_webhook_verify_token -w | pbcopy` and paste. **Verify and save**, then subscribe to the **comments** field.
5. **App settings → Basic**: Privacy Policy URL `https://affiliateos-api.rakshitdembla.workers.dev/privacy` (review the text first), app icon and category (needed to go Live).
   Optional: if webhook deliveries are rejected as "signature mismatch", also set the Meta app secret: `pnpm exec wrangler secret put META_APP_SECRET`. The Instagram page shows which secret verified each delivery.
6. Make sure your Instagram account has a role on the app (App roles → Roles / Instagram testers; accept the invite in Instagram if asked).
7. Set `IG_APP_ID`, deploy (`pnpm --filter @affiliateos/api deploy`), then AffiliateOS → **Instagram → Connect Instagram**.

**Access level / app mode (verify for your app):** Meta's webhook docs state the app must be **Live** to receive notifications and list **Advanced Access** for the `comments` field (Advanced Access requires App Review and Business Verification). The Business Login docs state Standard Access is enough for accounts you own. Which applies to your app is confirmed once connected: a real comment on your reel either appears in the Instagram page's event log or it doesn't.

## Runbook (v1.0.0)

### Health
Desktop → Settings → **System health** (also summarised on the Overview when something needs attention): database, storage, Instagram token/webhooks, queue backlog and uncertain replies, Mac engine last seen, backups, daily maintenance. API: `GET /api/v1/system/status`.

### Daily maintenance (cron `17 3 * * *` UTC)
Refresh Instagram tokens nearing expiry → recover stale jobs → turn leftover comments into jobs → retention clean-up → backup. Steps are isolated; a failing step is logged (`cron_step_failed`) and the rest still run.

### Restore
1. **Preferred — D1 Time Travel** (point-in-time, built in):
   `pnpm exec wrangler d1 time-travel info affiliateos` then
   `pnpm exec wrangler d1 time-travel restore affiliateos --timestamp=<ISO time before the incident>`
2. **From an R2 backup** (any of the newest 14 daily snapshots, or one made with Settings → Back up now):
   ```sh
   cd apps/api
   pnpm exec wrangler r2 object get affiliateos-images/backups/<file>.json.gz --remote --file backup.json.gz
   node scripts/backup-to-sql.mjs backup.json.gz > restore.sql      # review it
   pnpm exec wrangler d1 execute affiliateos --remote --file restore.sql
   ```
   The target database must have the migrations listed in the backup. Restore drill (2026-11-20, local): all tables matched row-for-row.

### Rotate secrets
- **Admin API token** (lost device): `openssl rand -hex 32 | pnpm exec wrangler secret put ADMIN_API_TOKEN`, then paste the new token in the app's Settings.
- **Instagram app secret**: update in the Meta dashboard, then `pnpm exec wrangler secret put IG_APP_SECRET`.
- **Token encryption key**: `openssl rand -base64 32 | pnpm exec wrangler secret put TOKEN_ENCRYPTION_KEY`, then reconnect Instagram (old ciphertext can no longer be read — by design).

### Incidents
- *Replies stopped*: check System health → engine (is the app open / paused?), Instagram status, Logs filtered to `error`.
- *Instagram "bothersome or abusive" warning*: the engine auto-pauses. Review automations (keywords too broad?) before resuming.
- *Uncertain replies*: Message Queue → the job → "Check delivery with Instagram", or mark sent / retry.

### Desktop release
`pnpm --filter @affiliateos/desktop tauri build` → `apps/desktop/src-tauri/target/release/bundle/dmg/AffiliateOS_<version>_aarch64.dmg`. The app is ad-hoc signed: it opens normally when built on this Mac; on another Mac, right-click → Open (or sign with an Apple Developer ID).
