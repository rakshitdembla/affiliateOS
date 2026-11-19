/**
 * Automation logic shared by the Worker (authoritative: matching + rendering at job creation) and the desktop
 * app (live preview and validation in the editor), so both always agree.
 */

export const MATCH_MODES = ["word", "contains", "exact"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const TEMPLATE_VARIABLES = ["COLLECTION_URL", "COLLECTION_NAME", "USERNAME"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/** Instagram's limit for a message's text (UTF-8 bytes). */
export const MAX_MESSAGE_BYTES = 1000;
/** Instagram usernames are at most 30 characters; used to size-check templates before activation. */
export const MAX_USERNAME_LENGTH = 30;
export const MAX_KEYWORDS = 20;
export const MAX_KEYWORD_LENGTH = 50;
/** Meta: a private reply can be sent within 7 days of the comment's creation. */
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

const ZERO_WIDTH = /[​-‍⁠﻿]/g;

/** Normalise for matching: Unicode NFKC, case-insensitive, zero-width characters removed, whitespace collapsed. */
export function normalizeText(s: string): string {
  return s.normalize("NFKC").replace(ZERO_WIDTH, "").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}

/** "link, Link , shoes" → ["link","shoes"] (normalised, de-duplicated, empty entries dropped). */
export function parseKeywords(input: string | string[]): string[] {
  const parts = (Array.isArray(input) ? input : [input]).flatMap((x) => x.split(/[,\n]/));
  const out: string[] = [];
  for (const p of parts) {
    const k = normalizeText(p);
    // A keyword needs at least one letter, number or emoji; punctuation-only entries would match unpredictably.
    if (k && /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * - word (default): the keyword appears as a whole word or phrase ("link please" ✓, "linked" ✗)
 * - contains: the keyword appears anywhere ("linked" ✓)
 * - exact: the comment is just the keyword, ignoring surrounding punctuation/emoji ("LINK!!" ✓, "link pls" ✗)
 */
export function matchesKeyword(comment: string, keyword: string, mode: MatchMode): boolean {
  const text = normalizeText(comment);
  const kw = normalizeText(keyword);
  if (!text || !kw) return false;
  if (mode === "contains") return text.includes(kw);
  if (mode === "exact") return text.replace(EDGE, "") === kw.replace(EDGE, "");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(kw)}(?![\\p{L}\\p{N}])`, "u").test(text);
}

export const matchesAny = (comment: string, keywords: string[], mode: MatchMode): boolean => keywords.some((k) => matchesKeyword(comment, k, mode));

export interface TemplateValues { collectionUrl: string; collectionName: string; username?: string | null }

export function renderTemplate(template: string, v: TemplateValues): string {
  const username = (v.username ?? "").trim();
  return template
    .replace(/\[COLLECTION_URL\]/g, v.collectionUrl)
    .replace(/\[COLLECTION_NAME\]/g, v.collectionName)
    .replace(/\[USERNAME\]/g, username ? `@${username.replace(/^@/, "")}` : "")
    // Tidy up if USERNAME was empty: "Hey !" → "Hey!", double spaces → single.
    .replace(/[ \t]+([!?.,:;])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
}

export interface TemplateCheck { ok: boolean; errors: string[]; warnings: string[]; maxBytes: number }

/** Validate a template for activation. `sample` gives the real collection URL/name so the size check is exact. */
export function validateTemplate(template: string, sample?: { collectionUrl: string; collectionName: string }): TemplateCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!template.trim()) errors.push("The message is empty.");
  const unknown = [...template.matchAll(/\[([A-Z_]+)\]/g)].map((m) => m[1]!).filter((n) => !(TEMPLATE_VARIABLES as readonly string[]).includes(n));
  for (const n of [...new Set(unknown)]) errors.push(`Unknown variable [${n}]. Use [COLLECTION_URL], [COLLECTION_NAME] or [USERNAME].`);
  if (!template.includes("[COLLECTION_URL]")) errors.push("The message must include [COLLECTION_URL] so the person receives the link.");
  if (/\[[a-z_]+\]/i.test(template.replace(/\[([A-Z_]+)\]/g, ""))) warnings.push("Variables are case-sensitive, e.g. [COLLECTION_URL].");
  const longest = renderTemplate(template, {
    collectionUrl: sample?.collectionUrl ?? "https://example.com/c/" + "x".repeat(80),
    collectionName: sample?.collectionName ?? "x".repeat(200),
    username: "u".repeat(MAX_USERNAME_LENGTH),
  });
  const maxBytes = utf8Bytes(longest);
  if (maxBytes > MAX_MESSAGE_BYTES) errors.push(`The message can reach ${maxBytes} bytes; Instagram allows ${MAX_MESSAGE_BYTES}.`);
  return { ok: errors.length === 0, errors, warnings, maxBytes };
}

export const DEFAULT_TEMPLATE = "Hey [USERNAME]! Here are the outfits you were looking for 👇\n\n[COLLECTION_URL]";
