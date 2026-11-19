import type { Env } from "./env";

export type Level = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: Level;
  module: string;
  operation?: string;
  entityId?: string;
  code?: string;
  message: string;
}

const SECRET_PATTERNS: RegExp[] = [
  /(bearer\s+)[a-z0-9._~+/=-]+/gi,
  /((?:access_token|token|secret|password|authorization)["'\s:=]+)[^\s"',&]+/gi,
  /\bEAA[A-Za-z0-9]{20,}\b/g, // Meta access tokens
];

/** Remove anything that looks like a credential before it reaches logs. */
export function sanitize(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, (_m, p1) => (typeof p1 === "string" ? `${p1}[REDACTED]` : "[REDACTED]"));
  return out.slice(0, 1000);
}

/** Structured JSON log to console; warn/error are also persisted to D1 for the Logs page. */
export async function log(env: Env | undefined, entry: LogEntry): Promise<void> {
  const clean = { ...entry, message: sanitize(entry.message) };
  const line = JSON.stringify({ ts: new Date().toISOString(), ...clean });
  (entry.level === "error" ? console.error : entry.level === "warn" ? console.warn : console.log)(line);
  if (!env || (entry.level !== "warn" && entry.level !== "error")) return;
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
