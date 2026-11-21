export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  /** Workers Rate Limiting: caps how often one IP can create view/click records. Optional (absent → no limit). */
  PUBLIC_RL?: RateLimit;
  APP_VERSION: string;
  ALLOWED_ORIGINS: string;
  /** Public origin used for OAuth redirect/webhook URLs, e.g. https://affiliateos-api.<account>.workers.dev */
  PUBLIC_BASE_URL?: string;
  /** "unified" (Facebook Login for Business — required for apps created since 2026) or "instagram" (Instagram Login). */
  IG_LOGIN_MODE?: string;
  /** Instagram App ID (public; Instagram Login mode). */
  IG_APP_ID?: string;
  /** Meta App ID (public; Unified login mode). */
  META_APP_ID?: string;
  /** Facebook Login for Business configuration id (public; Unified login mode). */
  FB_LOGIN_CONFIG_ID?: string;
  IG_GRAPH_VERSION?: string;
  /** E2E test seam only: loopback URL of a mock Instagram API (ignored unless http://localhost:<port>). */
  IG_GRAPH_BASE?: string;
  /** Shown on the privacy policy page as the contact route. */
  PRIVACY_CONTACT?: string;
  // ---- Secrets (wrangler secret put …) ----
  ADMIN_API_TOKEN?: string;
  /** Instagram App Secret (App Dashboard → Instagram → API setup with Instagram login). */
  IG_APP_SECRET?: string;
  /** Optional Meta App Secret (App settings → Basic); accepted for webhook signatures if set. */
  META_APP_SECRET?: string;
  IG_WEBHOOK_VERIFY_TOKEN?: string;
  /** base64-encoded 32-byte key for AES-256-GCM token encryption. */
  TOKEN_ENCRYPTION_KEY?: string;
}
