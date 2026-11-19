export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  APP_VERSION: string;
  ALLOWED_ORIGINS: string;
  /** Secret. Set with `wrangler secret put ADMIN_API_TOKEN`. */
  ADMIN_API_TOKEN?: string;
}
