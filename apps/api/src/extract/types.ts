import type { ExtractedFields, Platform } from "@affiliateos/shared";

/** Every affiliate platform implements this. Adapters are pure: HTML in, fields out. */
export interface PlatformAdapter {
  id: Platform;
  /** Hostnames (exact or subdomain suffix) this adapter owns, including short-link hosts. */
  hosts: string[];
  /** Normalised canonical URL from the final URL and/or page, if derivable. */
  canonicalUrl(finalUrl: URL, html: string): string | null;
  /** Extract fields from the HTML. Must never invent data: missing → null. */
  extract(html: string, finalUrl: URL): ExtractedFields;
  /** True if the page indicates the product is gone/unavailable. */
  isUnavailable(html: string): boolean;
}
