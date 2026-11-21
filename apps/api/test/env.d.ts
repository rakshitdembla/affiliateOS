/// <reference types="@cloudflare/vitest-plugin/types" />
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    IMAGES: R2Bucket;
    APP_VERSION: string;
    ALLOWED_ORIGINS: string;
    ADMIN_API_TOKEN?: string;
    PUBLIC_BASE_URL?: string;
    IG_APP_ID?: string;
    IG_LOGIN_MODE?: string;
    META_APP_ID?: string;
    FB_LOGIN_CONFIG_ID?: string;
    IG_GRAPH_VERSION?: string;
    IG_GRAPH_BASE?: string;
    PRIVACY_CONTACT?: string;
    IG_APP_SECRET?: string;
    META_APP_SECRET?: string;
    IG_WEBHOOK_VERIFY_TOKEN?: string;
    TOKEN_ENCRYPTION_KEY?: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
