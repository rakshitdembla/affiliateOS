# Environment

| Name | Where | Secret | Purpose |
|---|---|---|---|
| `ADMIN_API_TOKEN` | Worker (`wrangler secret put` / `.dev.vars`) | yes | Admin API auth |
| `ALLOWED_ORIGINS` | `wrangler.jsonc` vars | no | CORS allow-list |
| `APP_VERSION` | `wrangler.jsonc` vars | no | Reported by `/health` |
| `VITE_API_URL` | desktop build-time (optional) | no | Default API URL |
| Desktop API token | macOS Keychain, service `com.affiliateos.desktop` | yes | Entered in Settings |

Never commit `.dev.vars` or `.env*` (git-ignored).
