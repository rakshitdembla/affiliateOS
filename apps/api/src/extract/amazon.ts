import type { ExtractedFields } from "@affiliateos/shared";
import { genericExtract } from "./generic";
import { clip, decodeEntities, parsePriceMinor, textById } from "./html";
import type { PlatformAdapter } from "./types";

const ASIN = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i;

const stripTags = (fragment: string): string =>
  decodeEntities(fragment.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Text of the buy-box availability blocks only (Amazon pages mention "unavailable" elsewhere for other sizes/offers). */
function availabilityText(html: string): string {
  const parts: string[] = [];
  for (const m of html.matchAll(/id\s*=\s*["']availability["']/gi)) parts.push(stripTags(html.slice(m.index!, m.index! + 6000)).slice(0, 300));
  for (const m of html.matchAll(/class\s*=\s*["'][^"']*primary-availability-message[^"']*["'][^>]*>([\s\S]{0,300}?)<\/span>/gi)) parts.push(stripTags(m[1]!));
  return parts.join(" | ");
}

/** Price from the buy box ("price to pay"), not the first price anywhere on the page (which may be a sponsored item). */
function buyboxPrice(html: string): number | null {
  for (const anchor of ["priceToPay", "apex-pricetopay-value", "corePriceDisplay_desktop_feature_div", "corePrice_feature_div", "apex_desktop"]) {
    const i = html.indexOf(anchor);
    if (i < 0) continue;
    const seg = html.slice(i, i + 4000);
    const off = /class\s*=\s*["']a-offscreen["'][^>]*>\s*([^<]*?)\s*</i.exec(seg)?.[1];
    const fromOff = off && !/-/.test(off) ? parsePriceMinor(off) : null;
    if (fromOff) return fromOff;
    const whole = /class\s*=\s*["']a-price-whole["'][^>]*>([\d,]+)/i.exec(seg)?.[1];
    const frac = /class\s*=\s*["']a-price-fraction["'][^>]*>(\d+)/i.exec(seg)?.[1];
    if (whole) return parsePriceMinor(`${whole}.${frac ?? "00"}`);
  }
  return null;
}

/** "Buy X Online at Low Prices in India - Amazon.in" / "Amazon.in: X" → "X". */
const cleanMetaTitle = (t: string | null): string | null =>
  t?.replace(/^amazon\.(in|com)\s*:\s*/i, "").replace(/^buy\s+/i, "").replace(/\s*(online at (low|best) prices?.*|at amazon\.(in|com).*|[-|:]\s*amazon\.(in|com).*)$/i, "").trim() || null;

export const amazonAdapter: PlatformAdapter = {
  id: "amazon",
  hosts: ["amazon.in", "amazon.com", "amzn.to", "amzn.in", "a.co"],
  canonicalUrl(u) {
    const asin = ASIN.exec(u.pathname)?.[1];
    return asin ? `https://${u.hostname.replace(/^(smile|m)\./, "www.")}/dp/${asin.toUpperCase()}` : null;
  },
  extract(html, finalUrl): ExtractedFields {
    const base = genericExtract(html, finalUrl);
    const title = textById(html, "productTitle") ?? cleanMetaTitle(base.title);
    const hires =
      /id\s*=\s*["']landingImage["'][^>]*data-old-hires\s*=\s*["']([^"']+)["']/i.exec(html)?.[1] ??
      /"hiRes"\s*:\s*"(https:\/\/[^"]+)"/.exec(html)?.[1] ??
      /id\s*=\s*["']landingImage["'][^>]*data-a-dynamic-image\s*=\s*["']\{(?:&quot;|")(https:[^&"]+)/i.exec(html)?.[1];
    return {
      ...base,
      title: clip(title, 500),
      priceMinor: buyboxPrice(html) ?? base.priceMinor,
      imageUrl: base.imageUrl ?? (hires ?? null),
      canonicalUrl: this.canonicalUrl(new URL(base.canonicalUrl ?? finalUrl), html) ?? base.canonicalUrl,
    };
  },
  isUnavailable(html) {
    const t = availabilityText(html);
    if (/(?<!back )\bin stock\b|left in stock|usually dispatched|available to ship|ships within/i.test(t)) return false;
    return /currently unavailable|we don'?t know when or if this item will be back|out of stock/i.test(t);
  },
};
