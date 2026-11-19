import { defineConfig, devices } from "@playwright/test";
import { API, E2E_IG, E2E_TOKEN } from "./e2e/env";

const IG_VARS = Object.entries(E2E_IG).map(([k, v]) => `--var ${k}:${v}`).join(" ");

/**
 * End-to-end tests: the production web build in WebKit (the engine behind Tauri's macOS webview),
 * served with the exact CSP from tauri.conf.json, against a local Worker with a throwaway D1/R2 state.
 * The native Tauri layer (Keychain commands, opener) is replaced by an in-memory IPC stub; the real
 * Keychain path is covered by `cargo test -- --ignored` in src-tauri.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  outputDir: "test-results",
  use: { baseURL: "http://localhost:1420", trace: "retain-on-failure" },
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 820 } } }],
  webServer: [
    {
      command: `rm -rf .wrangler/e2e && pnpm exec wrangler d1 migrations apply affiliateos --local --persist-to .wrangler/e2e && pnpm exec wrangler dev --port 8787 --persist-to .wrangler/e2e --var ADMIN_API_TOKEN:${E2E_TOKEN} ${IG_VARS}`,
      cwd: "../api",
      url: `${API}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    { command: "pnpm build && pnpm exec vite preview --port 1420 --strictPort", url: "http://localhost:1420", reuseExistingServer: false, timeout: 120_000 },
  ],
});
