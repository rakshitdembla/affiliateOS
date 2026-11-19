import { detectPlatform, parseSafeUrl } from "./url";

export type FetchFailure = "invalid_url" | "redirect_unresolved" | "site_unreachable" | "extraction_blocked";

export type FetchOutcome =
  | { ok: true; html: string; finalUrl: URL }
  | { ok: false; code: FetchFailure; message: string };

const MAX_REDIRECTS = 5;
const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 8000;
const UA = "Mozilla/5.0 (compatible; AffiliateOS/0.1; personal product-metadata fetcher)";

const BLOCK_MARKERS = /captcha|robot check|automated access|access denied|are you a human|unusual traffic|verify you are human/i;

/**
 * Fetch a supported-platform page. Redirects are followed manually and every hop must be a
 * safe https URL on a supported platform host. We identify ourselves honestly and make no
 * attempt to evade bot protection: a challenge or 403/429 is reported as "blocked".
 */
export async function fetchPage(rawUrl: string): Promise<FetchOutcome> {
  let url = parseSafeUrl(rawUrl);
  if (!url) return { ok: false, code: "invalid_url", message: "Not a valid https URL" };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!detectPlatform(url)) {
      return { ok: false, code: "redirect_unresolved", message: `Redirect left the supported platforms (${url.hostname})` };
    }
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        redirect: "manual",
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-IN,en;q=0.8" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { ok: false, code: "site_unreachable", message: "The website could not be reached (network error or timeout)" };
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      let next: URL | null = null;
      try { next = loc ? parseSafeUrl(new URL(loc, url).toString()) : null; } catch { /* bad Location */ }
      if (!next) return { ok: false, code: "redirect_unresolved", message: "Redirect target was missing or unsafe" };
      url = next;
      continue;
    }
    if (res.status === 403 || res.status === 429 || res.status === 401 || res.status === 503) {
      return { ok: false, code: "extraction_blocked", message: `The website refused automated access (HTTP ${res.status})` };
    }
    if (res.status === 404 || res.status === 410) {
      return { ok: false, code: "site_unreachable", message: `Product page not found (HTTP ${res.status})` };
    }
    if (!res.ok) return { ok: false, code: "site_unreachable", message: `The website returned HTTP ${res.status}` };

    const html = (await readCapped(res, MAX_BYTES)).slice(0, MAX_BYTES);
    if (BLOCK_MARKERS.test(html.slice(0, 20000)) && !/<script[^>]+ld\+json/i.test(html)) {
      return { ok: false, code: "extraction_blocked", message: "The website served a bot-check page instead of the product" };
    }
    return { ok: true, html, finalUrl: url };
  }
  return { ok: false, code: "redirect_unresolved", message: "Too many redirects" };
}

async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = "", total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += dec.decode(value, { stream: true });
    if (total >= max) { await reader.cancel(); break; }
  }
  return out;
}
