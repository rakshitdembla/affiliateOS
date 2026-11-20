import type { ApiErrorBody, ActivityItem, Collection, CollectionDetail, ExtractionResult, HealthResponse, InstagramMedia, InstagramStatus, WebhookEventSummary, AnalyticsResponse, Automation, BackupInfo, SystemStatus, DmAttempt, DmJob, DmStatus, LogItem, MatchMode, QueueStats, RetryPolicy, SendResponse, OverviewResponse, Platform, Product, ProductList } from "@affiliateos/shared";
import { getToken } from "./secrets";

const URL_KEY = "affiliateos.apiUrl";
const DEFAULT_URL = import.meta.env.VITE_API_URL ?? "https://affiliateos-api.rakshitdembla.workers.dev";

export const getApiUrl = (): string => {
  try { return localStorage.getItem(URL_KEY) ?? DEFAULT_URL; } catch { return DEFAULT_URL; }
};
export const setApiUrl = (url: string): void => localStorage.setItem(URL_KEY, url.replace(/\/+$/, ""));

export class ApiError extends Error {
  constructor(public code: string, message: string, public status?: number) { super(message); }
}

async function request<T>(path: string, opts: { auth?: boolean; timeoutMs?: number; token?: string; baseUrl?: string; method?: string; body?: unknown; raw?: { body: BodyInit; type: string }; text?: boolean } = {}): Promise<T> {
  const { auth = true, timeoutMs = 8000 } = opts;
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.raw) headers["Content-Type"] = opts.raw.type;
  if (auth) {
    const token = opts.token ?? (await getToken());
    if (!token) throw new ApiError("no_token", "No API token configured. Add one in Settings.");
    headers.Authorization = `Bearer ${token}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${opts.baseUrl ?? getApiUrl()}${path}`, { method: opts.method ?? "GET", headers, signal: ctrl.signal, body: opts.raw ? opts.raw.body : opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch (e) {
    throw new ApiError(ctrl.signal.aborted ? "timeout" : "network", ctrl.signal.aborted ? "Request timed out" : "Could not reach the backend");
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  if (opts.text && res.ok) return (await res.text()) as T;
  if (res.status !== 204) { try { body = await res.json(); } catch { /* non-JSON */ } }
  if (!res.ok && !(path === "/health" && body)) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(err?.code ?? "http_error", err?.message ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

export interface ProductInput {
  affiliateUrl: string; platform: Platform; title: string; description?: string | null; imageUrl?: string | null;
  priceMinor?: number | null; currency?: string; canonicalUrl?: string | null;
  extractionStatus?: "success" | "partial" | "manual"; extractionError?: string | null;
}
export interface AutomationInput {
  mediaId: string; reelName: string; mediaPermalink?: string | null; collectionId: string; keywords: string[]; matchMode: MatchMode; messageTemplate: string; isActive: boolean;
}
export interface AnalyticsQuery { from: string; to: string; tz: string; collectionId?: string }
export interface ProductQuery { search?: string; platform?: string; status?: string; limit?: number; offset?: number }

export const api = {
  extract: (url: string) => request<ExtractionResult>("/api/v1/products/extract", { method: "POST", body: { url }, timeoutMs: 30000 }),
  listProducts: (q: ProductQuery = {}) => {
    const sp = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v !== undefined && v !== "" && sp.set(k, String(v)));
    return request<ProductList>(`/api/v1/products?${sp}`);
  },
  createProduct: (p: ProductInput) => request<Product>("/api/v1/products", { method: "POST", body: p, timeoutMs: 30000 }),
  updateProduct: (id: string, p: Partial<ProductInput> & { isActive?: boolean }) => request<Product>(`/api/v1/products/${id}`, { method: "PATCH", body: p, timeoutMs: 30000 }),
  refreshProduct: (id: string) => request<{ product: Product; extraction: ExtractionResult }>(`/api/v1/products/${id}/refresh`, { method: "POST", timeoutMs: 30000 }),
  listCollections: () => request<{ items: Collection[] }>("/api/v1/collections"),
  getCollection: (id: string) => request<CollectionDetail>(`/api/v1/collections/${id}`),
  createCollection: (b: { name: string; slug?: string; description?: string | null }) => request<CollectionDetail>("/api/v1/collections", { method: "POST", body: b }),
  updateCollection: (id: string, b: { name?: string; slug?: string; description?: string | null; isPublished?: boolean }) => request<CollectionDetail>(`/api/v1/collections/${id}`, { method: "PATCH", body: b }),
  deleteCollection: (id: string) => request<null>(`/api/v1/collections/${id}`, { method: "DELETE" }),
  duplicateCollection: (id: string) => request<CollectionDetail>(`/api/v1/collections/${id}/duplicate`, { method: "POST" }),
  setCollectionProducts: (id: string, productIds: string[]) => request<CollectionDetail>(`/api/v1/collections/${id}/products`, { method: "PUT", body: { productIds } }),
  uploadCover: (id: string, file: File) => request<CollectionDetail>(`/api/v1/collections/${id}/cover`, { method: "PUT", raw: { body: file, type: file.type }, timeoutMs: 30000 }),
  deleteCover: (id: string) => request<CollectionDetail>(`/api/v1/collections/${id}/cover`, { method: "DELETE" }),
  previewCollection: (id: string) => request<{ html: string }>(`/api/v1/collections/${id}/preview`),
  instagramStatus: () => request<InstagramStatus>("/api/v1/instagram/status"),
  connectInstagram: () => request<{ authorizeUrl: string; expiresAt: string }>("/api/v1/instagram/connect", { method: "POST" }),
  checkInstagram: () => request<InstagramStatus>("/api/v1/instagram/check", { method: "POST", timeoutMs: 25000 }),
  subscribeInstagram: () => request<InstagramStatus>("/api/v1/instagram/subscribe", { method: "POST", timeoutMs: 25000 }),
  refreshInstagramToken: () => request<InstagramStatus>("/api/v1/instagram/refresh-token", { method: "POST", timeoutMs: 25000 }),
  disconnectInstagram: () => request<InstagramStatus>("/api/v1/instagram/disconnect", { method: "POST", timeoutMs: 25000 }),
  instagramMedia: (after?: string) => request<{ items: InstagramMedia[]; after: string | null }>(`/api/v1/instagram/media${after ? `?after=${encodeURIComponent(after)}` : ""}`, { timeoutMs: 25000 }),
  instagramEvents: () => request<{ items: WebhookEventSummary[] }>("/api/v1/instagram/events?limit=50"),
  // ---- automations ----
  listAutomations: () => request<{ items: Automation[] }>("/api/v1/automations"),
  createAutomation: (b: AutomationInput) => request<Automation & { warnings: string[] }>("/api/v1/automations", { method: "POST", body: b }),
  updateAutomation: (id: string, b: Partial<AutomationInput>) => request<Automation & { warnings: string[] }>(`/api/v1/automations/${id}`, { method: "PATCH", body: b }),
  deleteAutomation: (id: string) => request<null>(`/api/v1/automations/${id}`, { method: "DELETE" }),
  // ---- queue ----
  queueSync: (b: { workerId: string; engineStatus: string; detail?: string; version?: string }) => request<QueueStats>("/api/v1/queue/sync", { method: "POST", body: b, timeoutMs: 20000 }),
  queueClaim: (workerId: string, limit: number) => request<{ jobs: DmJob[] }>("/api/v1/queue/claim", { method: "POST", body: { workerId, limit } }),
  queueRelease: (workerId: string) => request<{ released: number }>("/api/v1/queue/release", { method: "POST", body: { workerId } }),
  /** 409 means "not yours / already handled": not an error for the engine. */
  queueSend: async (id: string, workerId: string, policy: RetryPolicy): Promise<SendResponse> => {
    try { return await request<SendResponse>(`/api/v1/queue/jobs/${id}/send`, { method: "POST", body: { workerId, policy }, timeoutMs: 40000 }); }
    catch (e) { if (e instanceof ApiError && e.status === 409) return { outcome: "not_claimed", job: null, message: e.message }; throw e; }
  },
  queueJobs: (q: { status?: DmStatus | ""; q?: string; automationId?: string; limit?: number } = {}) => {
    const sp = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v !== undefined && v !== "" && sp.set(k, String(v)));
    return request<{ items: DmJob[]; stats: QueueStats }>(`/api/v1/queue/jobs?${sp}`);
  },
  queueJob: (id: string) => request<{ job: DmJob; attempts: DmAttempt[] }>(`/api/v1/queue/jobs/${id}`),
  queueAction: (id: string, action: "retry" | "skip" | "mark-sent", confirm = false) => request<{ message: string; job: DmJob }>(`/api/v1/queue/jobs/${id}/${action}`, { method: "POST", body: { confirm } }),
  queueReconcile: (id: string) => request<{ result: "sent" | "not_sent" | "unknown"; message: string; job: DmJob }>(`/api/v1/queue/jobs/${id}/reconcile`, { method: "POST", timeoutMs: 40000 }),
  // ---- logs ----
  logs: (q: { level?: string; module?: string; code?: string; entity?: string; q?: string; from?: string; to?: string; before?: string; limit?: number } = {}) => {
    const sp = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v !== undefined && v !== "" && sp.set(k, String(v)));
    return request<{ items: LogItem[]; facets: { modules: string[]; codes: string[] } }>(`/api/v1/logs?${sp}`);
  },
  engineLog: (e: { level: "info" | "warn" | "error"; operation: string; message: string; code?: string }) => request<unknown>("/api/v1/logs", { method: "POST", body: e }),
  analytics: (q: AnalyticsQuery) => request<AnalyticsResponse>(`/api/v1/analytics?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "") as [string, string][])}`),
  analyticsExport: (type: "daily" | "clicks" | "visits" | "messages", q: AnalyticsQuery) =>
    request<string>(`/api/v1/analytics/export?${new URLSearchParams([["type", type], ...(Object.entries(q).filter(([, v]) => v !== undefined && v !== "") as [string, string][])])}`, { text: true, timeoutMs: 60000 }),
  systemStatus: () => request<SystemStatus>("/api/v1/system/status", { timeoutMs: 20000 }),
  backups: () => request<{ items: BackupInfo[] }>("/api/v1/system/backups"),
  backupNow: () => request<{ key: string; bytes: number }>("/api/v1/system/backup", { method: "POST", timeoutMs: 60000 }),
  deleteProduct: (id: string) => request<null>(`/api/v1/products/${id}`, { method: "DELETE" }),
  health: (o?: { baseUrl?: string }) => request<HealthResponse>("/health", { auth: false, ...o }),
  overview: (o?: { token?: string; baseUrl?: string }) => request<OverviewResponse>("/api/v1/overview", o),
  activity: () => request<{ items: ActivityItem[] }>("/api/v1/activity"),
};
