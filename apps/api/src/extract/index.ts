import type { ExtractionResult, ExtractedFields } from "@affiliateos/shared";
import { adapterFor } from "./registry";
import { fetchPage } from "./fetcher";
import { detectPlatform, parseSafeUrl } from "./url";

const EMPTY: ExtractedFields = { title: null, description: null, imageUrl: null, priceMinor: null, currency: "INR", canonicalUrl: null };

const fail = (code: NonNullable<ExtractionResult["error"]>["code"], message: string, platform: ExtractionResult["platform"] = null, finalUrl: string | null = null): ExtractionResult =>
  ({ platform, status: "failed", fields: EMPTY, missing: ["title", "image", "price"], error: { code, message }, finalUrl });

export async function extractProduct(rawUrl: string): Promise<ExtractionResult> {
  const parsed = parseSafeUrl(rawUrl);
  if (!parsed) return fail("invalid_url", "That doesn't look like a valid https URL");
  const platform = detectPlatform(parsed);
  if (!platform) return fail("unsupported_url", "Only Amazon, Myntra and Meesho links are supported");
  const adapter = adapterFor(platform);
  if (!adapter) return fail("adapter_not_implemented", `No adapter for ${platform}`, platform);

  const page = await fetchPage(rawUrl);
  if (!page.ok) return fail(page.code, page.message, platform);

  const finalPlatform = detectPlatform(page.finalUrl) ?? platform;
  const finalAdapter = adapterFor(finalPlatform) ?? adapter;
  const finalUrl = page.finalUrl.toString();

  if (finalAdapter.isUnavailable(page.html)) {
    const f = finalAdapter.extract(page.html, page.finalUrl);
    return { platform: finalPlatform, status: "failed", fields: f, missing: ["price"], error: { code: "product_unavailable", message: "The product appears to be unavailable" }, finalUrl };
  }

  const fields = finalAdapter.extract(page.html, page.finalUrl);
  fields.canonicalUrl ??= finalAdapter.canonicalUrl(page.finalUrl, page.html);
  const missing: string[] = [];
  if (!fields.title) missing.push("title");
  if (!fields.imageUrl) missing.push("image");
  if (fields.priceMinor === null) missing.push("price");

  if (!fields.title) {
    return { platform: finalPlatform, status: "failed", fields, missing, error: { code: "parse_failed", message: "No product details could be read from the page" }, finalUrl };
  }
  return { platform: finalPlatform, status: missing.length ? "partial" : "success", fields, missing, error: null, finalUrl };
}
