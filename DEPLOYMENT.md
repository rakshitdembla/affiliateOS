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
