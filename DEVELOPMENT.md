# Development

Prerequisites (macOS): Node 22+ (tested on 25.9), pnpm 12, Rust stable (rustup), Xcode Command Line Tools.

```sh
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # set ADMIN_API_TOKEN
pnpm db:migrate:local
pnpm dev:api          # Worker on http://localhost:8787
pnpm dev:desktop      # Tauri app (starts Vite on :1420)
pnpm test && pnpm typecheck && pnpm build
```
Local D1/R2 are emulated by Wrangler under `apps/api/.wrangler/` (git-ignored). In the app, open Settings and enter `http://localhost:8787` plus your token.

Rust is installed via Homebrew's keg-only rustup; add `/opt/homebrew/opt/rustup/bin` to PATH (or `~/.cargo/bin`).

## Tests
```sh
pnpm test        # unit/integration: API (Workers runtime + D1/R2) and desktop components
pnpm e2e         # end-to-end in WebKit; starts an isolated local Worker on :8787 and the built app on :1420
cd apps/desktop/src-tauri && cargo test                 # Rust unit tests
cd apps/desktop/src-tauri && cargo test -- --ignored    # also round-trips the real macOS Keychain (test entry, cleaned up)
```
First E2E run: `pnpm --filter @affiliateos/desktop exec playwright install webkit`. Ports 8787 and 1420 must be free.
E2E replaces only the native Tauri layer (Keychain commands, opener) with an in-memory stub; everything else is real.
