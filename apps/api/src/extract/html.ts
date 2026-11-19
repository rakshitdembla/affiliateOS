const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}

const clean = (s: string | null | undefined): string | null => {
  const v = s ? decodeEntities(s).replace(/\s+/g, " ").trim() : "";
  return v ? v : null;
};

/** Read <meta property|name="key" content="..."> regardless of attribute order. */
export function metaContent(html: string, key: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const k = /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (k?.toLowerCase() !== key.toLowerCase()) continue;
    const c = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const v = clean(c?.[1] ?? c?.[2]);
    if (v) return v;
  }
  return null;
}

export function linkCanonical(html: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (/\brel\s*=\s*["']canonical["']/i.test(tag)) {
      const h = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      if (h) return decodeEntities(h);
    }
  }
  return null;
}

export function titleTag(html: string): string | null {
  return clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]);
}

export function textById(html: string, id: string): string | null {
  const m = new RegExp(`<[a-z0-9]+[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>([\\s\\S]*?)</[a-z0-9]+>`, "i").exec(html);
  return clean(m?.[1]?.replace(/<[^>]+>/g, " "));
}

/** Parse every <script type="application/ld+json"> block; invalid JSON is skipped. */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    try { out.push(JSON.parse(m[1]!.trim())); } catch { /* ignore malformed block */ }
  }
  return out;
}

/** "₹1,29,999.50" / "1299" / 1299 → minor units (paise). Returns null if not a sane number. */
export function parsePriceMinor(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[^\d.]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 1e8) return null;
  return Math.round(n * 100);
}

export interface JsonLdProduct {
  title: string | null; description: string | null; image: string | null;
  priceMinor: number | null; currency: string | null; url: string | null; availability: string | null;
}

function flatten(node: unknown, acc: Record<string, any>[] = []): Record<string, any>[] {
  if (Array.isArray(node)) node.forEach((n) => flatten(n, acc));
  else if (node && typeof node === "object") {
    acc.push(node as Record<string, any>);
    const g = (node as any)["@graph"];
    if (g) flatten(g, acc);
  }
  return acc;
}

export function jsonLdProduct(html: string): JsonLdProduct | null {
  for (const n of flatten(jsonLdBlocks(html))) {
    const t = n["@type"];
    if (!(t === "Product" || (Array.isArray(t) && t.includes("Product")))) continue;
    const offerRaw = Array.isArray(n.offers) ? n.offers[0] : n.offers;
    const offer = offerRaw?.["@type"] === "AggregateOffer" ? { ...offerRaw, price: offerRaw.lowPrice ?? offerRaw.price } : offerRaw;
    const img = Array.isArray(n.image) ? n.image[0] : n.image;
    return {
      title: clean(typeof n.name === "string" ? n.name : null),
      description: clean(typeof n.description === "string" ? n.description : null),
      image: typeof img === "string" ? img : typeof img?.url === "string" ? img.url : null,
      priceMinor: parsePriceMinor(offer?.price),
      currency: typeof offer?.priceCurrency === "string" ? offer.priceCurrency.toUpperCase() : null,
      url: typeof n.url === "string" ? n.url : typeof offer?.url === "string" ? offer.url : null,
      availability: typeof offer?.availability === "string" ? offer.availability : null,
    };
  }
  return null;
}

export const clip = (s: string | null, n: number): string | null => (s && s.length > n ? s.slice(0, n) : s);
