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
