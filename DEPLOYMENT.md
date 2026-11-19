# Deployment

**Not deployed yet.** Requires a Cloudflare login (`wrangler login`).

1. `wrangler d1 create affiliateos` → put the `database_id` in `apps/api/wrangler.jsonc`.
2. `wrangler r2 bucket create affiliateos-images`.
3. `pnpm --filter @affiliateos/api db:migrate:remote`.
4. `wrangler secret put ADMIN_API_TOKEN` (use a long random value).
5. `pnpm --filter @affiliateos/api deploy`, then verify `GET /health` on the workers.dev URL.
6. Desktop: `pnpm --filter @affiliateos/desktop tauri build` → `src-tauri/target/release/bundle/`.
   The CSP allows `*.workers.dev`/`*.pages.dev`; tighten it to your exact hostname.
