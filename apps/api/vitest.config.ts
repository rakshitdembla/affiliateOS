import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ADMIN_API_TOKEN: "test-token",
            PUBLIC_BASE_URL: "https://aos.example",
            IG_LOGIN_MODE: "instagram",
            IG_APP_ID: "1234567890",
            IG_APP_SECRET: "test-ig-app-secret",
            META_APP_SECRET: "test-meta-app-secret",
            IG_WEBHOOK_VERIFY_TOKEN: "test-verify-token",
            TOKEN_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
          },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"] },
  };
});
