import { Hono } from "hono";
import { z } from "zod";
import { PLATFORMS, type Product } from "@affiliateos/shared";
import type { Env } from "./env";
import { extractProduct } from "./extract";
import { validateAffiliateUrl } from "./extract/url";
import { cacheImage, deleteImage } from "./images";
import { log } from "./logger";

const platform = z.enum(PLATFORMS);
const httpsUrl = z.url().max(2000).refine((u) => u.startsWith("https://"), "Must be an https URL");

const createSchema = z.object({
  affiliateUrl: httpsUrl,
  platform,
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(2000).nullish(),
  imageUrl: httpsUrl.nullish(),
  priceMinor: z.number().int().min(0).max(100_000_000_00).nullish(),
  currency: z.string().length(3).default("INR"),
  canonicalUrl: httpsUrl.nullish(),
  extractionStatus: z.enum(["success", "partial", "manual"]).default("manual"),
  extractionError: z.string().max(500).nullish(),
});
const patchSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

type Row = Record<string, any>;
const toProduct = (r: Row, origin: string): Product => ({
  id: r.id, title: r.title, description: r.description, imageUrl: r.image_url,
  cachedImageUrl: r.cached_image_key ? `${origin}/img/${r.cached_image_key}` : null,
  priceMinor: r.price_minor, currency: r.currency, platform: r.platform,
  affiliateUrl: r.affiliate_url, canonicalUrl: r.canonical_url,
  extractionStatus: r.extraction_status, extractionError: r.extraction_error,
  lastExtractedAt: r.last_extracted_at, priceUpdatedAt: r.price_updated_at,
  isActive: !!r.is_active, createdAt: r.created_at, updatedAt: r.updated_at,
});

const bad = (c: any, code: string, message: string, status = 400) => c.json({ error: { code, message } }, status);
const originOf = (url: string) => new URL(url).origin;

export const products = new Hono<{ Bindings: Env }>();

/** Preview extraction without saving. Always 200: failure is data the UI must explain. */
products.post("/extract", async (c) => {
  const body = z.object({ url: z.string().min(1).max(2000) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return bad(c, "invalid_request", "A url is required");
  const result = await extractProduct(body.data.url);
  if (result.error) await log(c.env, { level: "info", module: "extract", operation: "preview", code: result.error.code, message: `${result.platform ?? "unknown"}: ${result.error.message}` });
  return c.json(result);
});

products.get("/", async (c) => {
  const q = c.req.query();
  const limit = Math.min(Math.max(parseInt(q.limit ?? "50", 10) || 50, 1), 100);
  const offset = Math.max(parseInt(q.offset ?? "0", 10) || 0, 0);
  const where: string[] = [], args: unknown[] = [];
  if (q.platform && (PLATFORMS as readonly string[]).includes(q.platform)) { where.push("platform = ?"); args.push(q.platform); }
  if (q.status === "active") where.push("is_active = 1");
  if (q.status === "inactive") where.push("is_active = 0");
  if (q.search?.trim()) { where.push("title LIKE ? ESCAPE '\\'"); args.push(`%${q.search.trim().replace(/[\\%_]/g, "\\$&")}%`); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows, total] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM products ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...args, limit, offset).all<Row>(),
    c.env.DB.prepare(`SELECT COUNT(*) n FROM products ${w}`).bind(...args).first<{ n: number }>(),
  ]);
  const origin = originOf(c.req.url);
  return c.json({ items: rows.results.map((r) => toProduct(r, origin)), total: total?.n ?? 0, limit, offset });
});

products.get("/:id", async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(c.req.param("id")).first<Row>();
  return r ? c.json(toProduct(r, originOf(c.req.url))) : bad(c, "not_found", "Product not found", 404);
});

products.post("/", async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, "invalid_request", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const d = parsed.data;
  if (!validateAffiliateUrl(d.affiliateUrl, d.platform)) return bad(c, "invalid_affiliate_url", `URL is not a valid ${d.platform} link`);

  const dup = await c.env.DB.prepare("SELECT id FROM products WHERE affiliate_url = ?").bind(d.affiliateUrl).first<{ id: string }>();
  if (dup) return c.json({ error: { code: "duplicate", message: "This affiliate URL is already saved" }, existingId: dup.id }, 409);

  const id = crypto.randomUUID();
  const imageKey = d.imageUrl ? await cacheImage(c.env, id, d.imageUrl) : null;
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO products (id,title,description,image_url,cached_image_key,price_minor,currency,platform,affiliate_url,canonical_url,
       extraction_status,extraction_error,last_extracted_at,price_updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(id, d.title, d.description ?? null, d.imageUrl ?? null, imageKey, d.priceMinor ?? null, d.currency.toUpperCase(), d.platform,
    d.affiliateUrl, d.canonicalUrl ?? null, d.extractionStatus, d.extractionError ?? null,
    d.extractionStatus === "manual" ? null : now, d.priceMinor != null ? now : null).run();
  const r = await c.env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(id).first<Row>();
  return c.json(toProduct(r!, originOf(c.req.url)), 201);
});

products.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, "invalid_request", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const cur = await c.env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(id).first<Row>();
  if (!cur) return bad(c, "not_found", "Product not found", 404);
  const d = parsed.data;

  const plat = d.platform ?? cur.platform, url = d.affiliateUrl ?? cur.affiliate_url;
  if ((d.platform || d.affiliateUrl) && !validateAffiliateUrl(url, plat)) return bad(c, "invalid_affiliate_url", `URL is not a valid ${plat} link`);
  if (d.affiliateUrl && d.affiliateUrl !== cur.affiliate_url) {
    const dup = await c.env.DB.prepare("SELECT id FROM products WHERE affiliate_url = ? AND id != ?").bind(d.affiliateUrl, id).first();
    if (dup) return bad(c, "duplicate", "Another product already uses this affiliate URL", 409);
  }

  let imageKey = cur.cached_image_key as string | null;
  if (d.imageUrl !== undefined && d.imageUrl !== cur.image_url) {
    const old = imageKey;
    imageKey = d.imageUrl ? await cacheImage(c.env, id, d.imageUrl) : null;
    if (old && old !== imageKey) await deleteImage(c.env, old);
  }
  const now = new Date().toISOString();
  const priceChanged = d.priceMinor !== undefined && d.priceMinor !== cur.price_minor;
  await c.env.DB.prepare(
    `UPDATE products SET title=?, description=?, image_url=?, cached_image_key=?, price_minor=?, currency=?, platform=?, affiliate_url=?,
       canonical_url=?, is_active=?, extraction_status=?, price_updated_at=?, updated_at=? WHERE id=?`,
  ).bind(
    d.title ?? cur.title, d.description !== undefined ? d.description : cur.description,
    d.imageUrl !== undefined ? d.imageUrl : cur.image_url, imageKey,
    d.priceMinor !== undefined ? d.priceMinor : cur.price_minor, (d.currency ?? cur.currency).toUpperCase(), plat, url,
    d.canonicalUrl !== undefined ? d.canonicalUrl : cur.canonical_url, d.isActive !== undefined ? (d.isActive ? 1 : 0) : cur.is_active,
    "manual", priceChanged ? now : cur.price_updated_at, now, id,
  ).run();
  const r = await c.env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(id).first<Row>();
  return c.json(toProduct(r!, originOf(c.req.url)));
});

/** Re-run extraction and overwrite only fields the page actually provided. */
products.post("/:id/refresh", async (c) => {
  const id = c.req.param("id");
  const cur = await c.env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(id).first<Row>();
  if (!cur) return bad(c, "not_found", "Product not found", 404);
  const res = await extractProduct(cur.affiliate_url);
  const now = new Date().toISOString();
  if (res.error && !res.fields.title) {
    await c.env.DB.prepare("UPDATE products SET extraction_status='failed', extraction_error=?, last_extracted_at=?, updated_at=? WHERE id=?")
      .bind(res.error.message, now, now, id).run();
  } else {
    const f = res.fields;
    let imageKey = cur.cached_image_key as string | null;
    if (f.imageUrl && f.imageUrl !== cur.image_url) imageKey = (await cacheImage(c.env, id, f.imageUrl)) ?? imageKey;
    const priceChanged = f.priceMinor !== null && f.priceMinor !== cur.price_minor;
    await c.env.DB.prepare(
      `UPDATE products SET title=?, image_url=?, cached_image_key=?, price_minor=?, canonical_url=?, extraction_status=?, extraction_error=?,
         last_extracted_at=?, price_updated_at=?, updated_at=? WHERE id=?`,
    ).bind(f.title ?? cur.title, f.imageUrl ?? cur.image_url, imageKey, f.priceMinor ?? cur.price_minor, f.canonicalUrl ?? cur.canonical_url,
      res.status === "success" ? "success" : "partial", res.error?.message ?? null, now, priceChanged ? now : cur.price_updated_at, now, id).run();
  }
  const r = await c.env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(id).first<Row>();
  return c.json({ product: toProduct(r!, originOf(c.req.url)), extraction: res });
});

products.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const cur = await c.env.DB.prepare("SELECT cached_image_key FROM products WHERE id = ?").bind(id).first<{ cached_image_key: string | null }>();
  if (!cur) return bad(c, "not_found", "Product not found", 404);
  await c.env.DB.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
  await deleteImage(c.env, cur.cached_image_key);
  return c.body(null, 204);
});
