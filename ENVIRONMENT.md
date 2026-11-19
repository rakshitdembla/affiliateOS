# Environment

| Name | Where | Secret | Purpose |
|---|---|---|---|
| `ADMIN_API_TOKEN` | Worker (`wrangler secret put` / `.dev.vars`) | yes | Admin API auth |
| `ALLOWED_ORIGINS` | `wrangler.jsonc` vars | no | CORS allow-list |
| `APP_VERSION` | `wrangler.jsonc` vars | no | Reported by `/health` |
| `PUBLIC_BASE_URL` | `wrangler.jsonc` vars | no | Base for OAuth redirect / webhook / privacy URLs |
| `IG_APP_ID` | `wrangler.jsonc` vars | no | Instagram App ID (public) |
| `IG_GRAPH_VERSION` | `wrangler.jsonc` vars | no | Graph API version (default `v27.0`) |
| `PRIVACY_CONTACT` | `wrangler.jsonc` vars (optional) | no | Contact line on `/privacy` |
| `IG_APP_SECRET` | Worker secret | yes | OAuth code exchange; webhook signature verification |
| `META_APP_SECRET` | Worker secret (optional) | yes | Alternative webhook signing secret |
| `IG_WEBHOOK_VERIFY_TOKEN` | Worker secret | yes | Webhook subscription handshake (copy also in Keychain: service `com.affiliateos.setup`) |
| `TOKEN_ENCRYPTION_KEY` | Worker secret | yes | base64 32-byte AES-256-GCM key for stored Instagram tokens. Rotating it means reconnecting Instagram |
| `IG_GRAPH_BASE` | E2E only (`--var`) | no | Mock Instagram API base; ignored unless `http://localhost:<port>` |
| `VITE_API_URL` | desktop build-time (optional) | no | Default API URL |
| Desktop API token | macOS Keychain, service `com.affiliateos.desktop` | yes | Entered in Settings |

Never commit `.dev.vars` or `.env*` (git-ignored).
