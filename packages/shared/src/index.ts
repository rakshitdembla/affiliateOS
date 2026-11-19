/** Contracts shared by the Worker API and the desktop app. */

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
