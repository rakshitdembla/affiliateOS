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
