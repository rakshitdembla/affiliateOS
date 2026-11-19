# Changelog

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
