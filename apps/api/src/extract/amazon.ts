import type { ExtractedFields } from "@affiliateos/shared";
import { genericExtract } from "./generic";
import { clip, parsePriceMinor, textById } from "./html";
import type { PlatformAdapter } from "./types";

const ASIN = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i;

export const amazonAdapter: PlatformAdapter = {
  id: "amazon",
  hosts: ["amazon.in", "amazon.com", "amzn.to", "amzn.in", "a.co"],
  canonicalUrl(u) {
    const asin = ASIN.exec(u.pathname)?.[1];
    return asin ? `https://${u.hostname.replace(/^(smile|m)\./, "www.")}/dp/${asin.toUpperCase()}` : null;
  },
  extract(html, finalUrl): ExtractedFields {
    const base = genericExtract(html, finalUrl);
    // Amazon pages rarely carry JSON-LD; fall back to well-known element ids.
    const title = base.title && !/^amazon\.(in|com)/i.test(base.title) ? base.title : textById(html, "productTitle");
    const whole = /class\s*=\s*["']a-price-whole["'][^>]*>([\d,]+)/i.exec(html)?.[1];
    const frac = /class\s*=\s*["']a-price-fraction["'][^>]*>(\d+)/i.exec(html)?.[1];
    const domPrice = whole ? parsePriceMinor(`${whole}.${frac ?? "00"}`) : null;
    const hires =
      /id\s*=\s*["']landingImage["'][^>]*data-old-hires\s*=\s*["']([^"']+)["']/i.exec(html)?.[1] ??
      /"hiRes"\s*:\s*"(https:\/\/[^"]+)"/.exec(html)?.[1] ??
      /id\s*=\s*["']landingImage["'][^>]*data-a-dynamic-image\s*=\s*["']\{(?:&quot;|")(https:[^&"]+)/i.exec(html)?.[1];
    return {
      ...base,
      title: clip(title, 500),
      priceMinor: base.priceMinor ?? domPrice,
      imageUrl: base.imageUrl ?? (hires ?? null),
      canonicalUrl: this.canonicalUrl(new URL(base.canonicalUrl ?? finalUrl), html) ?? base.canonicalUrl,
    };
  },
  isUnavailable: (html) => /currently unavailable|we don'?t know when or if this item will be back/i.test(html),
};
