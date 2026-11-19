# API (v0.1)

Errors: `{ "error": { "code": string, "message": string } }`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | none | `200 ok` / `503 degraded`; checks D1 and R2 |
| GET | `/api/v1/ping` | Bearer | Auth check |
| GET | `/api/v1/overview` | Bearer | Counts: products, collections, clicks, DM queue, Instagram status |
| GET | `/api/v1/activity` | Bearer | Latest 10 warn/error log entries |
