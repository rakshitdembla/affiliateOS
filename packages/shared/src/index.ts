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
