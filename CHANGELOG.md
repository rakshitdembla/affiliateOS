# Changelog

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
