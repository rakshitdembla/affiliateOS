import type { Env } from "./env";

export type Level = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: Level;
  module: string;
  operation?: string;
  entityId?: string;
  code?: string;
  message: string;
  /** Persist an info-level entry (warn/error are always persisted). Use for important business events. */
  persist?: boolean;
}

const SECRET_PATTERNS: RegExp[] = [
  /(bearer\s+)[a-z0-9._~+/=-]+/gi,
  /((?:access_token|token|secret|password|authorization)["']?\s*[:=]\s*["']?)[^\s"',&]+/gi,
  /\bEAA[A-Za-z0-9]{20,}\b/g, // Meta access tokens
  /\bIG[A-Za-z0-9_-]{30,}/g, // Instagram user access tokens
  /((?:client_secret|code|signed_request)=)[^\s&"']+/gi,
];

/** Remove anything that looks like a credential before it reaches logs. */
export function sanitize(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, (_m, p1) => (typeof p1 === "string" ? `${p1}[REDACTED]` : "[REDACTED]"));
  return out.slice(0, 1000);
}

/** Structured JSON log to console; warn/error are also persisted to D1 for the Logs page. */
export async function log(env: Env | undefined, entry: LogEntry): Promise<void> {
  const { persist: _persist, ...rest } = entry;
  const clean = { ...rest, message: sanitize(entry.message) };
  const line = JSON.stringify({ ts: new Date().toISOString(), ...clean });
  (entry.level === "error" ? console.error : entry.level === "warn" ? console.warn : console.log)(line);
  if (!env || (entry.level !== "warn" && entry.level !== "error" && !entry.persist)) return;
  try {
    await env.DB.prepare(
      "INSERT INTO app_logs (id, level, module, operation, entity_id, code, message) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), clean.level, clean.module, clean.operation ?? null, clean.entityId ?? null, clean.code ?? null, clean.message)
      .run();
  } catch (e) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", module: "logger", message: "log persist failed" }));
  }
}

/**
 * For events any anonymous client can trigger (rejected webhooks, bad OAuth states): persist at most one entry
 * per code per window so the public endpoints can't be used to flood the log table. Every occurrence still
 * reaches the console (Workers observability).
 */
export async function logThrottled(env: Env, entry: LogEntry, windowMinutes = 10): Promise<void> {
  try {
    const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
    const recent = await env.DB.prepare("SELECT 1 AS x FROM app_logs WHERE module = ? AND code = ? AND logged_at >= ? LIMIT 1").bind(entry.module, entry.code ?? null, since).first();
    await log(recent ? undefined : env, recent ? entry : { ...entry, message: `${entry.message} (further occurrences within ${windowMinutes} min are not stored)` });
  } catch {
    await log(undefined, entry);
  }
}
