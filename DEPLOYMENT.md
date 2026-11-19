# Deployment

**Deployed (Phase 1):** https://affiliateos-api.rakshitdembla.workers.dev — D1 `affiliateos` and R2 `affiliateos-images` created, migrations 0001–0003 applied remotely, `ADMIN_API_TOKEN` set as a Worker secret.

To reproduce on a new account (requires `wrangler login`):

1. `wrangler d1 create affiliateos` → put the `database_id` in `apps/api/wrangler.jsonc`.
2. `wrangler r2 bucket create affiliateos-images`.
3. `pnpm --filter @affiliateos/api db:migrate:remote`.
4. `wrangler secret put ADMIN_API_TOKEN` (use a long random value).
5. `pnpm --filter @affiliateos/api deploy`, then verify `GET /health` on the workers.dev URL.
6. Desktop: `pnpm --filter @affiliateos/desktop tauri build` → `src-tauri/target/release/bundle/`.
   The CSP allows only the deployed Worker hostname; update `tauri.conf.json` if it changes.
