# API (v0.1)

Errors: `{ "error": { "code": string, "message": string } }`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | none | `200 ok` / `503 degraded`; checks D1 and R2 |
| GET | `/api/v1/ping` | Bearer | Auth check |
| GET | `/api/v1/overview` | Bearer | Counts: products, collections, clicks, DM queue, Instagram status |
| GET | `/api/v1/activity` | Bearer | Latest 10 warn/error log entries |

## Products (Phase 2) — all Bearer-authenticated

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/products/extract` | Body `{url}`. Preview only; always 200. Returns `ExtractionResult` (`status` success/partial/failed, `missing`, `error.code`) |
| GET | `/api/v1/products` | Query: `search`, `platform`, `status=active\|inactive`, `limit` (≤100), `offset` |
| POST | `/api/v1/products` | Create. URL must be https and belong to the stated platform. `409 duplicate` (with `existingId`) if URL already saved |
| GET | `/api/v1/products/:id` | One product |
| PATCH | `/api/v1/products/:id` | Edit title/price/image/platform/URL/active; marks `extractionStatus=manual` |
| POST | `/api/v1/products/:id/refresh` | Re-extract; only overwrites fields the page provided; on failure keeps data and records the error |
| DELETE | `/api/v1/products/:id` | Deletes row and cached image |
| GET | `/img/products/:uuid.ext` | **Public**. Cached image from R2 (immutable) |

Extraction error codes: `invalid_url`, `unsupported_url`, `redirect_unresolved`, `site_unreachable`, `extraction_blocked`, `product_unavailable`, `adapter_not_implemented`, `parse_failed`.

## Collections (Phase 3) — Bearer-authenticated

| Method | Path | Description |
|---|---|---|
| GET/POST | `/api/v1/collections` | List (with `productCount`, `publicUrl`) / create (`slug` auto-generated and de-duplicated if omitted) |
| GET/PATCH/DELETE | `/api/v1/collections/:id` | Detail with ordered products / edit (`isPublished` requires ≥1 active product) / delete (`409 in_use` if an automation references it) |
| PUT | `/api/v1/collections/:id/products` | Body `{productIds:[…]}` replaces the ordered list atomically (add/remove/reorder) |
| POST | `/api/v1/collections/:id/duplicate` | Copy as unpublished draft |
| PUT/DELETE | `/api/v1/collections/:id/cover` | Upload raw image body (JPEG/PNG/WebP/AVIF/GIF ≤5 MB) / remove |
| GET | `/api/v1/collections/:id/preview` | `{html}` of the public page for any collection; not tracked |

## Public routes (no auth)

| Path | Description |
|---|---|
| `GET /c/:slug` | Server-rendered storefront for a **published** collection (404 otherwise). Optional `?s=<source>` is attributed to views/clicks. Records a view (bots flagged) |
| `GET /go/:productId?c=<collectionId>&s=<source>` | 302 to the product's saved affiliate URL, unmodified. 404 for unknown/inactive/malformed ids. `c` is honoured only if the product belongs to that collection. Records a click (bots flagged). No other redirect parameter is read |
| `GET /img/…` | Cached images (products, collection covers) |
| `GET /robots.txt` | Disallows `/go/` and `/api/` |
