# Architecture

```
 Mac (Tauri app) ──HTTPS + Bearer token──▶ Cloudflare Worker ──▶ D1 (SQL) / R2 (images)
                                              ▲
 Meta webhooks ───(signature verified)────────┘   Public pages + /go/:id redirects (Phase 3)
```

The Worker, D1 and R2 run independently of the Mac. Incoming Instagram events are stored in `webhook_events` and turned into `dm_jobs`; the desktop app claims and sends jobs when it is open (Phase 5).

## Decisions
- **Hono** on Workers for routing/middleware. **Zod** for validation (used from Phase 2).
- **Auth:** single admin Bearer token (Worker secret `ADMIN_API_TOKEN`), compared in constant time; fails closed if unset. Desktop stores the token in the macOS Keychain via a Rust command restricted to an allow-list of keys.
- **CORS:** allow-list of origins from `ALLOWED_ORIGINS`.
- **Logging:** structured JSON; warn/error persisted to `app_logs`; credential patterns redacted.
- **Money:** integer minor units (`price_minor`).
- **UI:** shadcn-style primitives (cva + tailwind-merge) written by hand in `components/ui`; the shadcn CLI is not used.

## Database (migrations in `apps/api/migrations`)
| Migration | Tables |
|---|---|
| 0001 | `products`, `collections`, `collection_products` (many-to-many, ordered) |
| 0002 | `instagram_accounts` (encrypted token), `automations`, `webhook_events` (unique `dedupe_key`), `dm_jobs` (unique `comment_id`, lease columns, status incl. `uncertain`), `dm_attempts` |
| 0003 | `click_events`, `app_logs` |

Only Phase 1 reads these tables (counts and recent logs); the schema is a starting design and may be revised by later phases via new migrations.

## Product extraction (Phase 2)
`apps/api/src/extract`: `fetcher` (https-only, host allow-list re-checked on every redirect hop, 8s timeout, 3 MB cap, honest User-Agent, no bot-check evasion) → `PlatformAdapter` per platform (`amazon`, `myntra`, `meesho`, registered in `registry.ts`) → shared `generic` strategy: JSON-LD → Open Graph/meta → `<title>`, plus platform-specific fallbacks. Missing data stays `null`; prices are stored in paise. Images are copied to R2 on save when possible (failure is non-fatal). No official affiliate APIs are integrated yet (they require credentials); this is the documented fallback tier.

## Storefront and tracking (Phase 3)
The public site is served by the same Worker (`storefront.ts`, `storefront-render.ts`): server-rendered HTML with inline CSS, Open Graph tags, a per-request CSP nonce (the only script hides broken images), and `rel="sponsored nofollow"` on product links. Collection pages are tied to the Worker host, e.g. `https://affiliateos-api.<account>.workers.dev/c/<slug>`; a custom domain can be added later without code changes. Click and view rows carry an `is_bot` flag (user-agent heuristic; link-preview crawlers such as WhatsApp count as bots); analytics exclude flagged rows. There is no per-IP rate limiting yet; Cloudflare's platform protections apply.

## Instagram (Phase 4)
Official **Instagram API with Instagram Login** (graph.instagram.com, `v27.0`), per Meta's Business Login, webhook and private-reply docs.
- **Connect:** desktop asks the Worker for an authorize URL (state: 32 random bytes, single use, 10 min) and opens it in the default browser via the Tauri opener plugin (https-only). Instagram redirects to the Worker, which consumes the state atomically, exchanges code → short-lived → long-lived token (~60 days), reads the profile, encrypts the token (AES-256-GCM, key in a Worker secret, AAD = Instagram user id) and subscribes the account to `comments` webhooks. The desktop polls status until the connection appears. One account at a time; connecting another replaces it.
- **Tokens:** never returned by the API or logged (log sanitizer redacts token-like strings). A daily cron refreshes tokens with < 20 days left; failures mark the account `expired`/record `last_error` and appear in the activity log.
- **Webhooks:** signature verified with constant-time HMAC against the Instagram app secret or (optional) the Meta app secret. Both documented payload shapes are parsed; 16+ digit ids are kept as strings. Each change becomes a `webhook_events` row (`comment:<id>` dedupe key; redeliveries counted). Unsigned/invalid deliveries are rejected and never stored; log rows for rejections are throttled to one per 10 minutes. If the secret is missing or storage fails the endpoint answers 503/500 so Meta retries (up to 36h) — events are not dropped. Direct-message content is never stored. Matching comments to automations and sending private replies is Phase 5.
- **Meta compliance:** signed deauthorize and data-deletion callbacks, deletion status page, and `/privacy`.
