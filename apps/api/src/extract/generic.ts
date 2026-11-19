import type { ExtractedFields } from "@affiliateos/shared";
import { clip, jsonLdProduct, linkCanonical, metaContent, parsePriceMinor, titleTag } from "./html";

/** Shared strategy: structured data (JSON-LD) → Open Graph / meta → <title>. Never fabricates values. */
export function genericExtract(html: string, finalUrl: URL): ExtractedFields {
  const ld = jsonLdProduct(html);
  const og = (k: string) => metaContent(html, k);
  const title = ld?.title ?? og("og:title") ?? og("twitter:title") ?? titleTag(html);
  const priceMinor =
    ld?.priceMinor ??
    parsePriceMinor(og("product:price:amount") ?? og("og:price:amount") ?? og("twitter:data1"));
  const rawImage = ld?.image ?? og("og:image") ?? og("twitter:image");
  let imageUrl: string | null = null;
  if (rawImage) { try { imageUrl = new URL(rawImage, finalUrl).toString(); } catch { /* bad URL */ } }
  let canonical: string | null = null;
  const c = linkCanonical(html) ?? og("og:url") ?? ld?.url;
  if (c) { try { canonical = new URL(c, finalUrl).toString(); } catch { /* ignore */ } }
  return {
    title: clip(title, 500),
    description: clip(ld?.description ?? og("og:description") ?? og("description"), 2000),
    imageUrl,
    priceMinor,
    currency: ld?.currency ?? og("product:price:currency") ?? og("og:price:currency") ?? "INR",
    canonicalUrl: canonical,
  };
}
