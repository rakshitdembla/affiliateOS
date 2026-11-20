# Security

AffiliateOS is single-user software, but it holds an Instagram access token, sends messages on your behalf and serves public pages, so it is built and reviewed as production software. Last review: 2026-11-20 (v1.0.0).

## What is protected, and how

| Asset / surface | Controls |
|---|---|
| Admin API (`/api/v1/*`) | 256-bit bearer token (Worker secret), constant-time comparison, fails closed if unset; failed attempts logged (throttled); CORS allow-list (desktop origins only); generic error bodies |
| Admin token on the Mac | macOS Keychain via a Rust command restricted to one allow-listed key; never in localStorage or the bundle |
| Instagram access token | AES-256-GCM, key only in a Worker secret, ciphertext bound to the account id (AAD); never returned by the API, never logged (log sanitiser redacts token-like strings); backups contain only the ciphertext |
| OAuth | single-use 256-bit `state`, 10-minute expiry, consumed atomically; code exchange server-side |
| Webhooks | `X-Hub-Signature-256` HMAC verified in constant time against the app secret(s); unsigned/invalid → 401, never stored; 1 MB body cap; rejection logs throttled |
| Meta compliance callbacks | `signed_request` HMAC verified; deauthorize/data deletion delete stored account data |
| Public pages (`/c`, `/go`, `/img`) | Redirects only to saved, validated affiliate URLs (no user-supplied destinations); strict per-request CSP with nonce; HTML escaping; per-IP rate limit on analytics writes (visitors always served); `/img` serves only product/collection keys (backups are not reachable) |
| Product extraction | https only, host allow-list re-checked on every redirect hop, no IP literals/ports/credentials, size and time limits, honest User-Agent, no bot-protection evasion |
| Desktop webview | Tauri capabilities: window dragging and opening `https://` links only; CSP limited to the Worker host; native commands: Keychain (one key) and CSV export to ~/Downloads (sanitised name, never overwrites) |
| Transport/headers | HTTPS only (workers.dev), HSTS, `X-Content-Type-Options`, `Permissions-Policy`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`; `preview_urls` disabled |
| Secrets in source | none; `.dev.vars`/`.env` ignored; history scanned (only fake test strings match token patterns) |
| Dependencies | `pnpm audit`: no known vulnerabilities (prod and dev) as of 2026-11-20 |
| Data minimisation | raw comment events 90 days, comment text on reply records 180 days, logs 90 days, backups 14 days; no IPs stored |

## Review findings fixed in v1.0.0
- Unauthenticated public endpoints could create unbounded view/click rows → per-IP rate limit on recording.
- Failed admin authentication was invisible → throttled `auth_failed` log entries.
- Development tooling pulled vulnerable `undici`/`sharp`/`zod` versions through a deprecated test package → migrated to `@cloudflare/vitest-plugin`.
- Missing HSTS/Permissions-Policy headers → added globally.
- Preview URLs exposed alternate hostnames → disabled.

## Known residual risks
- The desktop app is ad-hoc signed (no Apple Developer ID). Builds from this repo open normally; distributing the app to other Macs would need signing and notarisation.
- Bot detection for analytics is a user-agent heuristic; determined fake traffic within the rate limit can still be counted.
- Anyone with the admin token has full control; rotate it if a device is lost (see DEPLOYMENT.md → Runbook).
- The privacy policy at `/privacy` was written to describe the system accurately but has not been reviewed by a lawyer.
