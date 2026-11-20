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

## Instagram (Phase 4)

Admin (Bearer):

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/instagram/status` | Config readiness (`missing[]`), Meta dashboard URLs, connected account (never the token), webhook stats |
| POST | `/api/v1/instagram/connect` | Returns `{authorizeUrl}` with a single-use 10-minute `state`; `503 instagram_not_configured` lists what is missing |
| POST | `/api/v1/instagram/check` | Calls `/me` and `/me/subscribed_apps`; marks the account `expired` on token errors |
| POST | `/api/v1/instagram/subscribe` | Subscribe the account to `comments` webhooks |
| POST | `/api/v1/instagram/refresh-token` | Refresh the long-lived token now (Instagram requires it to be ≥24h old) |
| POST | `/api/v1/instagram/disconnect` | Best-effort unsubscribe, then delete the account and token |
| GET | `/api/v1/instagram/media?after=` | Recent posts/reels (id, caption, type, permalink, thumbnail) |
| GET | `/api/v1/instagram/events?limit=` | Recent webhook events (newest first) |

Public:

| Path | Description |
|---|---|
| `GET /oauth/instagram/callback` | OAuth redirect target. Consumes `state` once; exchanges code → long-lived token; encrypts and stores it; subscribes webhooks |
| `GET /webhooks/instagram` | Verification handshake (`hub.mode`, `hub.verify_token`, `hub.challenge`) |
| `POST /webhooks/instagram` | Deliveries. `X-Hub-Signature-256` must match `IG_APP_SECRET` (or `META_APP_SECRET`). `401` unsigned/invalid; `503` if no secret configured and `500` if storage fails (Meta retries both for up to 36h); `413` > 1 MB. Dedupe key `comment:<id>`; redeliveries increment `delivery_count` |
| `POST /oauth/instagram/deauthorize` | Meta `signed_request`; deletes the account and token |
| `POST /oauth/instagram/data-deletion` | Meta `signed_request`; deletes data, returns `{url, confirmation_code}` |
| `GET /oauth/instagram/deletion-status?code=` | Deletion confirmation page |
| `GET /privacy` | Privacy policy |

## Automations (Phase 5) — Bearer

| Method | Path | Description |
|---|---|---|
| GET/POST | `/api/v1/automations` | List (with matched/sent/pending/failed stats) / create. Body: `mediaId, reelName, mediaPermalink?, collectionId, keywords[], matchMode (word\|contains\|exact), messageTemplate, isActive`. Activation requires a published collection and a valid template (`[COLLECTION_URL]` required; ≤ 1000 bytes rendered). Response includes `warnings[]` |
| GET/PATCH/DELETE | `/api/v1/automations/:id` | Read / partial update (same validation) / delete (queued jobs are kept) |

## DM queue — Bearer

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/queue/sync` | `{workerId?, engineStatus?, version?}` → recovers stale work, turns received comments into jobs, records the engine heartbeat, returns `QueueStats` |
| GET | `/api/v1/queue/stats` | Counts by status, due now, next retry, attempts in the last hour, hourly cap, account state |
| POST | `/api/v1/queue/claim` | `{workerId, limit≤20}` → `{jobs}` (atomic, 5-minute lease, oldest first) |
| POST | `/api/v1/queue/release` | `{workerId}` → returns this engine's unstarted claims |
| POST | `/api/v1/queue/jobs/:id/send` | `{workerId, policy?}` → `SendResponse` (`sent`, `retryable`, `permanent`, `ineligible`, `uncertain`, `blocked` + `stopEngine`, `rate_limited` + `retryAfterSeconds`). `409` if not claimed by this engine or already started |
| GET | `/api/v1/queue/jobs?status=&q=&automationId=&before=&limit=` | List (newest first) + stats |
| GET | `/api/v1/queue/jobs/:id` | Job + attempt history |
| POST | `/api/v1/queue/jobs/:id/reconcile` | Uncertain only: check delivery via the Conversations API |
| POST | `/api/v1/queue/jobs/:id/retry` | Failed/skipped/uncertain (uncertain needs `{confirm:true}`); refused past the 7-day window |
| POST | `/api/v1/queue/jobs/:id/skip` · `/mark-sent` | Manual resolution (not for in-flight jobs) |
| GET | `/api/v1/queue/engines` | Recent engine heartbeats |

## Logs — Bearer

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/logs?level=error,warn&module=&code=&entity=&q=&from=&to=&before=&limit=` | Filtered entries (newest first) + facets (modules, codes) |
| POST | `/api/v1/logs` | Desktop engine events (`module` is always `engine`) |

## Analytics (Phase 6) — Bearer

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/analytics?from=&to=&tz=&collectionId=` | Totals (human visits/clicks, bot visits/clicks shown separately, comments, reply counts, success rate = sent ÷ (sent + failed)), zero-filled daily series grouped in the viewer's timezone (`tz` = minutes east of UTC, e.g. 330), clicks by platform/source/collection (with clicks per visit), top products. Default range: last 30 days; max 400 days. With `collectionId`, comments = comments that matched an automation for that collection |
| GET | `/api/v1/analytics/export?type=daily\|clicks\|visits\|messages&…` | CSV (all cells quoted; values starting with `= + - @` are prefixed with `'` to prevent spreadsheet formula injection) |

## System (Phase 7) — Bearer

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/system/status` | `{overall, checks[{id,label,status: ok\|warn\|error, detail}]}` — database, storage, Instagram, queue, engine, webhooks, backups, daily maintenance |
| POST | `/api/v1/system/backup` | Snapshot all tables to R2 now (gzipped JSON; newest 14 kept) |
| GET | `/api/v1/system/backups` | List backups |
