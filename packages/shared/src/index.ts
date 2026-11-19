/** Contracts shared by the Worker API and the desktop app. */
export * from "./automation";

export interface HealthResponse {
  status: "ok" | "degraded";
  service: "affiliateos-api";
  version: string;
  time: string;
  checks: {
    database: { ok: boolean; latencyMs?: number; error?: string };
    storage: { ok: boolean; latencyMs?: number; error?: string };
  };
}

export interface OverviewResponse {
  products: number;
  collections: number;
  publishedCollections: number;
  clicks: number;
  pendingMessages: number;
  failedMessages: number;
  uncertainMessages: number;
  sentToday: number;
  instagram: { connected: boolean; username: string | null };
  lastEventAt: string | null;
}

export interface ActivityItem {
  id: string;
  time: string;
  level: "debug" | "info" | "warn" | "error";
  module: string;
  message: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

// ---- Products (Phase 2) ----
export const PLATFORMS = ["amazon", "myntra", "meesho"] as const;
export type Platform = (typeof PLATFORMS)[number];

export type ExtractionStatus = "pending" | "success" | "partial" | "failed" | "manual";

export type ExtractionErrorCode =
  | "invalid_url"
  | "unsupported_url"
  | "redirect_unresolved"
  | "site_unreachable"
  | "extraction_blocked"
  | "product_unavailable"
  | "adapter_not_implemented"
  | "parse_failed";

export interface ExtractedFields {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  priceMinor: number | null;
  currency: string;
  canonicalUrl: string | null;
}

export interface ExtractionResult {
  platform: Platform | null;
  status: ExtractionStatus; // success | partial | failed
  fields: ExtractedFields;
  /** Fields that could not be found, e.g. ["price","image"] */
  missing: string[];
  error: { code: ExtractionErrorCode; message: string } | null;
  finalUrl: string | null;
}

export interface Product {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  cachedImageUrl: string | null;
  priceMinor: number | null;
  currency: string;
  platform: Platform;
  affiliateUrl: string;
  canonicalUrl: string | null;
  extractionStatus: ExtractionStatus;
  extractionError: string | null;
  lastExtractedAt: string | null;
  priceUpdatedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductList {
  items: Product[];
  total: number;
  limit: number;
  offset: number;
}

// ---- Collections (Phase 3) ----
export interface Collection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  coverImageUrl: string | null;
  /** Cover if uploaded, else first product image; for admin cards only. */
  previewImageUrl: string | null;
  isPublished: boolean;
  productCount: number;
  publicUrl: string;
  createdAt: string;
  updatedAt: string;
}
export interface CollectionDetail extends Collection {
  products: Product[];
}

// ---- Instagram (Phase 4) ----
export interface InstagramAccount {
  igUserId: string;
  username: string | null;
  accountType: string | null;
  profilePictureUrl: string | null;
  status: "connected" | "expired" | "revoked" | "error";
  scopes: string[];
  tokenExpiresAt: string | null;
  tokenRefreshedAt: string | null;
  webhooksSubscribed: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  connectedAt: string;
}
export interface InstagramStatus {
  config: {
    ready: boolean;
    /** Names of missing settings, e.g. IG_APP_ID, IG_APP_SECRET, TOKEN_ENCRYPTION_KEY, IG_WEBHOOK_VERIFY_TOKEN */
    missing: string[];
    graphVersion: string;
    metaSecretConfigured: boolean;
    redirectUri: string;
    webhookUrl: string;
    privacyUrl: string;
    deauthorizeUrl: string;
    dataDeletionUrl: string;
  };
  account: InstagramAccount | null;
  webhooks: { total: number; last24h: number; lastReceivedAt: string | null; lastSignatureKey: string | null };
}
export interface InstagramMedia {
  id: string;
  caption: string | null;
  mediaType: string | null;
  mediaProductType: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  timestamp: string | null;
}
export interface WebhookEventSummary {
  id: string;
  eventType: string;
  status: "received" | "queued" | "ignored" | "malformed" | "error";
  error: string | null;
  mediaId: string | null;
  commentId: string | null;
  fromUsername: string | null;
  text: string | null;
  receivedAt: string;
  deliveryCount: number;
  signatureKey: string | null;
}

// ---- Automations & DM queue (Phase 5) ----
import type { MatchMode } from "./automation";
export type DmStatus = "pending" | "processing" | "sent" | "failed" | "skipped" | "uncertain";
export const DM_STATUSES: DmStatus[] = ["pending", "processing", "sent", "failed", "skipped", "uncertain"];
/** Why a job ended where it did: sent, temporarily failed, permanently rejected, ineligible, duplicate, or unknown outcome. */
export type DmOutcome = "sent" | "retryable" | "permanent" | "ineligible" | "duplicate" | "uncertain";

export interface Automation {
  id: string;
  mediaId: string;
  reelName: string;
  mediaPermalink: string | null;
  collectionId: string;
  collectionName: string | null;
  collectionSlug: string | null;
  collectionPublished: boolean;
  keywords: string[];
  matchMode: MatchMode;
  messageTemplate: string;
  isActive: boolean;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  stats: { matched: number; sent: number; pending: number; failed: number };
}

export interface DmJob {
  id: string;
  commentId: string;
  mediaId: string;
  automationId: string | null;
  reelName: string | null;
  collectionId: string | null;
  collectionName: string | null;
  recipientId: string | null;
  recipientUsername: string | null;
  commentText: string | null;
  message: string;
  status: DmStatus;
  outcome: DmOutcome | null;
  attemptCount: number;
  receivedAt: string;
  processedAt: string | null;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  sentAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  claimedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DmAttempt {
  id: string;
  attemptedAt: string;
  outcome: "sent" | "retryable" | "permanent" | "uncertain" | "ineligible";
  httpStatus: number | null;
  errorCode: string | null;
  graphCode: number | null;
  graphSubcode: number | null;
  detail: string | null;
  durationMs: number | null;
  workerId: string | null;
}

export interface RetryPolicy { maxAttempts: number; baseDelaySeconds: number; maxDelaySeconds: number }

export interface QueueStats {
  counts: Record<DmStatus, number>;
  dueNow: number;
  nextRetryAt: string | null;
  attemptsLastHour: number;
  hourlyCap: number;
  account: { connected: boolean; status: string | null; username: string | null };
  ingested: { created: number; ignored: number };
  serverTime: string;
}

export interface SendResponse {
  outcome: "sent" | "retryable" | "permanent" | "ineligible" | "uncertain" | "blocked" | "rate_limited" | "not_claimed";
  job: DmJob | null;
  /** Present when every further send would fail the same way (or risk the account): the engine must stop. */
  stopEngine?: { code: string; reason: string };
  retryAfterSeconds?: number;
  message?: string;
}

export interface LogItem {
  id: string;
  time: string;
  level: "debug" | "info" | "warn" | "error";
  module: string;
  operation: string | null;
  entityId: string | null;
  code: string | null;
  message: string;
}
