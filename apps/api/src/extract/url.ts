import type { Platform } from "@affiliateos/shared";
import { adapters } from "./registry";

export function hostMatches(host: string, pattern: string): boolean {
  return host === pattern || host.endsWith("." + pattern);
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Basic SSRF hygiene: https only, no credentials, no custom ports, no IP literals or internal names. */
export function parseSafeUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "443") return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || IPV4.test(h) || h.includes(":") || h.startsWith("[")) return null;
  if (/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(h)) return null;
  return u;
}

export function detectPlatform(u: URL): Platform | null {
  const h = u.hostname.toLowerCase();
  for (const a of adapters) if (a.hosts.some((p) => hostMatches(h, p))) return a.id;
  return null;
}

/** An affiliate URL is storable if it's safe https and belongs to the stated platform. */
export function validateAffiliateUrl(raw: string, platform: Platform): URL | null {
  const u = parseSafeUrl(raw);
  return u && detectPlatform(u) === platform ? u : null;
}
