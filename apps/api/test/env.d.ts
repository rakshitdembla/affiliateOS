/// <reference types="@cloudflare/vitest-pool-workers/types" />
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    IMAGES: R2Bucket;
    APP_VERSION: string;
    ALLOWED_ORIGINS: string;
    ADMIN_API_TOKEN?: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
