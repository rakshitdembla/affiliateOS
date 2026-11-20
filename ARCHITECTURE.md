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

## Automations and the DM queue (Phase 5)
```
comment ──webhook──▶ Worker: verify + store event ──▶ match automation ──▶ dm_jobs (one per comment)
                                                                              │
Mac engine (when AffiliateOS is open):  sync ─▶ claim (lease) ─▶ send ────────┘──▶ Worker calls Instagram with the
                                         ▲                          │              server-held token, records outcome
                                         └── pacing, budget, pause, cooldown, retries, crash recovery
```
- **Matching (Worker, idempotent):** runs right after each webhook, at every desktop sync, and from the daily cron. Own comments are ignored; the oldest active automation for the post whose keywords match wins (whole-word by default, case-insensitive, Unicode-normalised; logic shared with the desktop editor). One job per comment (`UNIQUE comment_id`); a second request from the same person on the same automation within 7 days becomes `skipped/duplicate`. The message is rendered at queue time with `?s=instagram` for click attribution; if the collection's slug changes before sending, the link is updated.
- **Claiming:** `UPDATE … WHERE id IN (SELECT … due …) RETURNING` gives each engine a 5-minute lease; concurrent engines never get the same job.
- **Sending:** the engine asks the Worker to send a claimed job. The Worker checks connection, the 7-day window, that the collection is still published and the message size, then writes `send_started_at` (the attempt token) before calling `POST /<IG_ID>/messages` with `recipient.comment_id`. Every finalising update is conditional on that token, so duplicate or retried requests cannot send twice. The send continues even if the Mac disconnects mid-request (`waitUntil`).
- **Outcomes:** sent · retryable (bounded exponential backoff with jitter, then `failed`) · permanent (`failed`) · ineligible (`skipped`) · duplicate (`skipped`) · uncertain (no definite answer from Instagram — never retried automatically). Instagram error codes are mapped per Meta's error reference; problems affecting every send (expired token, permission, messaging disabled, the "bothersome or abusive" warning) stop the engine and keep the job queued. Hard server cap: 700 sends/hour (Meta: 750).
- **Recovery:** expired leases return unstarted jobs to the queue; a send that started but never finished becomes `uncertain`; pending jobs past the 7-day window are skipped. Uncertain jobs can be checked against the Conversations API (confirm → `sent`; absent → re-queued; can't tell → stays uncertain) or resolved manually.
- **Engine (desktop, `src/engine`):** starts with the app (unless paused), gives back stale claims on start, syncs/claims/sends with configurable spacing, hourly budget (counted on the server, so restarts don't reset it), poll interval and retry policy. Pause/resume persists across restarts. Self-healing waits (Instagram not connected, backend offline with exponential backoff, rate-limit cooldown) resume automatically; account-level problems auto-pause until resumed by hand. App Nap is disabled in `Info.plist` so background windows keep normal timer speed.

## Analytics (Phase 6)
Computed on demand from D1 (`click_events`, `collection_views`, `dm_jobs`, `webhook_events`); no separate pipeline. Bot/preview traffic (user-agent heuristic) is excluded from headline numbers and reported separately. Earnings and conversions are not shown — no affiliate network reporting is connected. Desktop exports are written by a native command (`save_export`) to ~/Downloads only (sanitised `.csv` names, never overwriting) and revealed in Finder; no general file-system permission is granted to the webview.
