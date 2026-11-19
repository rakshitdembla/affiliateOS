import type { ApiErrorBody, ActivityItem, HealthResponse, OverviewResponse } from "@affiliateos/shared";
import { getToken } from "./secrets";

const URL_KEY = "affiliateos.apiUrl";
const DEFAULT_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export const getApiUrl = (): string => {
  try { return localStorage.getItem(URL_KEY) ?? DEFAULT_URL; } catch { return DEFAULT_URL; }
};
export const setApiUrl = (url: string): void => localStorage.setItem(URL_KEY, url.replace(/\/+$/, ""));

export class ApiError extends Error {
  constructor(public code: string, message: string, public status?: number) { super(message); }
}

async function request<T>(path: string, opts: { auth?: boolean; timeoutMs?: number; token?: string; baseUrl?: string } = {}): Promise<T> {
  const { auth = true, timeoutMs = 8000 } = opts;
  const headers: Record<string, string> = {};
  if (auth) {
    const token = opts.token ?? (await getToken());
    if (!token) throw new ApiError("no_token", "No API token configured. Add one in Settings.");
    headers.Authorization = `Bearer ${token}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${opts.baseUrl ?? getApiUrl()}${path}`, { headers, signal: ctrl.signal });
  } catch (e) {
    throw new ApiError(ctrl.signal.aborted ? "timeout" : "network", ctrl.signal.aborted ? "Request timed out" : "Could not reach the backend");
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok && !(path === "/health" && body)) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(err?.code ?? "http_error", err?.message ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

export const api = {
  health: (o?: { baseUrl?: string }) => request<HealthResponse>("/health", { auth: false, ...o }),
  overview: (o?: { token?: string; baseUrl?: string }) => request<OverviewResponse>("/api/v1/overview", o),
  activity: () => request<{ items: ActivityItem[] }>("/api/v1/activity"),
};
