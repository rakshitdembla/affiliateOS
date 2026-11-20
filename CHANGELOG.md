# Changelog

## 0.6.0 — Phase 6 (analytics)
- Analytics API: visits, clicks (bots excluded and reported), clicks per visit, comments, replies sent/failed/skipped/pending/uncertain, success rate, daily series in the viewer's timezone, breakdowns by platform, source, collection and product; collection filter; CSV export (daily, clicks, visits, messages) with formula-injection protection.
- Desktop Analytics page: range presets/custom range, collection filter, KPI tiles, daily chart with tooltip and table view, breakdowns, CSV export to ~/Downloads via a native command.
- Tests: shared 18, API 151, desktop 39, E2E 11 (real storefront traffic → dashboard → CSV), Rust 3.

## 0.5.0 — Phase 5 (automations and DM queue)
- Automations: reel ↔ keywords ↔ collection, match modes (whole word / contains / exact), message templates with [COLLECTION_URL], [COLLECTION_NAME], [USERNAME], validation before activation, stats. Matching and template logic shared by Worker and desktop.
- DM queue: jobs created from comment webhooks (one per comment, duplicates per person marked), leased atomic claiming, server-performed sends with an attempt token (no double sends), outcome classification per Meta's error codes, bounded backoff with jitter, 700/hour cap, crash recovery, 7-day window handling, delivery checks for uncertain sends via the Conversations API, manual retry/skip/mark-sent. Migration 0006.
- Desktop engine: auto-start, pacing, hourly budget, pause/resume (persisted), cooldowns, offline backoff, auto-pause on account-level problems; App Nap disabled.
- Desktop: Automations, Message Queue (job details with attempt history) and Logs pages; queue status in the sidebar.
- Tests: shared 18, API 146, desktop 36, E2E 10 (incl. full comment → reply pipeline against a mock Instagram API), Rust 2.

## 0.4.0 — Phase 4 (Instagram integration)
- Business Login for Instagram: connect (single-use OAuth state), long-lived token stored AES-256-GCM encrypted, account status/check/refresh/disconnect, recent media listing.
- Webhook receiver: handshake, HMAC signature verification (Instagram or Meta app secret), both payload shapes, dedupe with redelivery counts, malformed-payload retention, retry-friendly 503/500, throttled rejection logging.
- Daily cron refreshes tokens before expiry. Deauthorize and data-deletion callbacks, deletion status page, privacy policy page. Migration 0005.
- Desktop: Instagram page (setup checklist, Meta dashboard values with copy, connect via browser, token lifetime, webhook event log, recent reels); external links now open through the Tauri opener plugin (https only).
- Fixed: log sanitizer redacted ordinary words after "secret"/"token"; webhook event ordering for same-millisecond deliveries.
- Tests: API 102, desktop 19, E2E 9, Rust 2.

## 0.3.1 — Verification of Phases 1–3
- Added end-to-end tests (Playwright, WebKit) that drive the production web build under the exact Tauri CSP against a local Worker: first run/settings, products, collections, phone storefront, `/go` redirect. Added an opt-in Rust test that round-trips the real macOS Keychain.
- Fixed: the Overview "Backend health" card always showed "Unreachable" in the app — `/health` sent no CORS headers.
- Fixed: Amazon availability was read from the whole page, so in-stock items with an unavailable size/offer were flagged "unavailable" (and "back in stock" matched "in stock"). Now read from the buy-box availability block only.
- Fixed: Amazon price could come from the first price anywhere on the page (e.g. a sponsored item); now taken from the buy box, otherwise reported missing.
- Fixed: Amazon titles now come from the product title element instead of "Buy … at Amazon.in" meta titles.
- Fixed: interstitial/error pages served with HTTP 200 (Myntra's "Site Maintenance") could become a product titled after the page; now reported as blocked, and a bare `<title>` is never accepted as product data.
- Fixed: a failed fetch result stayed attached after the URL was edited, storing a stale extraction error.
- UI: duplicated error sentence, collection card action overflow, storefront image placeholder text and title weight; sidebar shows the real version.

## 0.3.0 — Phase 3
- Collections API (CRUD, duplicate, ordered products, covers, preview), migration 0004 (`collection_views`).
- Public storefront `/c/:slug`, `/go/:id` redirect with click tracking, robots.txt.
- Desktop Collections page with drag-and-drop/arrow ordering, publish, preview, duplicate, delete.
- Tests: API 59, desktop 13.

## 0.2.0 — Phase 2
- Product CRUD API, extraction adapters (Amazon, Myntra, Meesho), R2 image caching, public `/img` route.
- Desktop Products page: add (fetch → review → save), manual fallback, edit, refresh, delete with confirmation, search/filter.
- Tests: API 44, desktop 7.

## 0.1.0 — Phase 1
- Monorepo, Worker API with health/overview/activity, D1 migrations 0001–0003, R2 binding.
- Tauri desktop shell, dashboard, Keychain-backed token storage, Settings page.
- API integration tests and desktop component test.
- Deployed Worker to Cloudflare; remote D1 migrations applied; CSP restricted to the Worker hostname.
