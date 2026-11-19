import { Hono } from "hono";
import { z } from "zod";
import type { Collection, CollectionDetail, Product } from "@affiliateos/shared";
import type { Env } from "./env";
import { deleteImage, IMAGE_TYPES, storeImage } from "./images";
import { renderCollectionPage } from "./storefront-render";
import { productFromRow } from "./products";

type Row = Record<string, any>;
const slugRe = /^[a-z0-9][a-z0-9-]{0,79}$/;
const bad = (c: any, code: string, message: string, status = 400) => c.json({ error: { code, message } }, status);
const origin = (url: string) => new URL(url).origin;

export const slugify = (s: string): string =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "") || "collection";

async function uniqueSlug(env: Env, base: string, excludeId?: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const cand = i === 0 ? base : `${base.slice(0, 74)}-${i + 1}`;
    const hit = await env.DB.prepare("SELECT id FROM collections WHERE slug = ? AND id != ?").bind(cand, excludeId ?? "").first();
    if (!hit) return cand;
  }
  return `${base.slice(0, 60)}-${crypto.randomUUID().slice(0, 8)}`;
}

const LIST_SQL = `SELECT c.*,
  (SELECT COUNT(*) FROM collection_products cp WHERE cp.collection_id = c.id) AS product_count,
  (SELECT COALESCE(p.cached_image_key, p.image_url) FROM collection_products cp JOIN products p ON p.id = cp.product_id
     WHERE cp.collection_id = c.id AND COALESCE(p.cached_image_key, p.image_url) IS NOT NULL ORDER BY cp.position LIMIT 1) AS first_image
  FROM collections c`;

export function collectionFromRow(r: Row, org: string): Collection {
  const img = (k: string | null) => (!k ? null : k.startsWith("https://") ? k : `${org}/img/${k}`);
  const cover = img(r.cover_image_key);
  return {
    id: r.id, name: r.name, slug: r.slug, description: r.description, coverImageUrl: cover,
    previewImageUrl: cover ?? img(r.first_image ?? null), isPublished: !!r.is_published, productCount: r.product_count ?? 0,
    publicUrl: `${org}/c/${r.slug}`, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function loadProducts(env: Env, collectionId: string, org: string, onlyActive = false): Promise<Product[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.* FROM collection_products cp JOIN products p ON p.id = cp.product_id
     WHERE cp.collection_id = ? ${onlyActive ? "AND p.is_active = 1" : ""} ORDER BY cp.position, cp.added_at`,
  ).bind(collectionId).all<Row>();
  return results.map((r) => productFromRow(r, org));
}

async function detail(env: Env, id: string, org: string): Promise<CollectionDetail | null> {
  const r = await env.DB.prepare(`${LIST_SQL} WHERE c.id = ?`).bind(id).first<Row>();
  return r ? { ...collectionFromRow(r, org), products: await loadProducts(env, id, org) } : null;
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().regex(slugRe, "Slug may use lowercase letters, numbers and hyphens").optional(),
  description: z.string().trim().max(2000).nullish(),
});
const patchSchema = createSchema.partial().extend({ isPublished: z.boolean().optional() });

export const collections = new Hono<{ Bindings: Env }>();

collections.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`${LIST_SQL} ORDER BY c.updated_at DESC`).all<Row>();
  return c.json({ items: results.map((r) => collectionFromRow(r, origin(c.req.url))) });
});

collections.post("/", async (c) => {
  const p = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return bad(c, "invalid_request", p.error.issues.map((i) => i.message).join("; "));
  let slug: string;
  if (p.data.slug) {
    if (await c.env.DB.prepare("SELECT 1 FROM collections WHERE slug = ?").bind(p.data.slug).first()) return bad(c, "slug_taken", "That slug is already in use", 409);
    slug = p.data.slug;
  } else slug = await uniqueSlug(c.env, slugify(p.data.name));
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO collections (id,name,slug,description) VALUES (?,?,?,?)").bind(id, p.data.name, slug, p.data.description ?? null).run();
  return c.json(await detail(c.env, id, origin(c.req.url)), 201);
});

collections.get("/:id", async (c) => {
  const d = await detail(c.env, c.req.param("id"), origin(c.req.url));
  return d ? c.json(d) : bad(c, "not_found", "Collection not found", 404);
});

collections.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const p = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return bad(c, "invalid_request", p.error.issues.map((i) => i.message).join("; "));
  const cur = await c.env.DB.prepare("SELECT * FROM collections WHERE id = ?").bind(id).first<Row>();
  if (!cur) return bad(c, "not_found", "Collection not found", 404);
  const d = p.data;
  if (d.slug && d.slug !== cur.slug && (await c.env.DB.prepare("SELECT 1 FROM collections WHERE slug = ? AND id != ?").bind(d.slug, id).first()))
    return bad(c, "slug_taken", "That slug is already in use", 409);
  if (d.isPublished) {
    const n = await c.env.DB.prepare("SELECT COUNT(*) n FROM collection_products cp JOIN products p ON p.id = cp.product_id WHERE cp.collection_id = ? AND p.is_active = 1").bind(id).first<{ n: number }>();
    if (!n?.n) return bad(c, "empty_collection", "Add at least one active product before publishing", 409);
  }
  await c.env.DB.prepare("UPDATE collections SET name=?, slug=?, description=?, is_published=?, updated_at=? WHERE id=?")
    .bind(d.name ?? cur.name, d.slug ?? cur.slug, d.description !== undefined ? d.description : cur.description,
      d.isPublished !== undefined ? (d.isPublished ? 1 : 0) : cur.is_published, new Date().toISOString(), id).run();
  return c.json(await detail(c.env, id, origin(c.req.url)));
});

collections.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const cur = await c.env.DB.prepare("SELECT cover_image_key FROM collections WHERE id = ?").bind(id).first<Row>();
  if (!cur) return bad(c, "not_found", "Collection not found", 404);
  try { await c.env.DB.prepare("DELETE FROM collections WHERE id = ?").bind(id).run(); }
  catch { return bad(c, "in_use", "This collection is used by an automation. Remove or repoint the automation first.", 409); }
  await deleteImage(c.env, cur.cover_image_key);
  return c.body(null, 204);
});

collections.post("/:id/duplicate", async (c) => {
  const src = await c.env.DB.prepare("SELECT * FROM collections WHERE id = ?").bind(c.req.param("id")).first<Row>();
  if (!src) return bad(c, "not_found", "Collection not found", 404);
  const id = crypto.randomUUID();
  const name = `${src.name} (copy)`.slice(0, 200);
  const slug = await uniqueSlug(c.env, slugify(`${src.slug}-copy`));
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO collections (id,name,slug,description,is_published) VALUES (?,?,?,?,0)").bind(id, name, slug, src.description),
    c.env.DB.prepare("INSERT INTO collection_products (collection_id,product_id,position) SELECT ?, product_id, position FROM collection_products WHERE collection_id = ?").bind(id, src.id),
  ]);
  if (src.cover_image_key) {
    const obj = await c.env.IMAGES.get(src.cover_image_key);
    if (obj) {
      const type = obj.httpMetadata?.contentType ?? "image/jpeg";
      const key = await storeImage(c.env, `collections/${id}`, await obj.arrayBuffer(), type);
      if (key) await c.env.DB.prepare("UPDATE collections SET cover_image_key = ? WHERE id = ?").bind(key, id).run();
    }
  }
  return c.json(await detail(c.env, id, origin(c.req.url)), 201);
});

/** Replace the full ordered product list atomically (covers add, remove and reorder). */
collections.put("/:id/products", async (c) => {
  const id = c.req.param("id");
  const p = z.object({ productIds: z.array(z.uuid()).max(500) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return bad(c, "invalid_request", "productIds must be an array of product IDs");
  const ids = p.data.productIds;
  if (new Set(ids).size !== ids.length) return bad(c, "invalid_request", "Duplicate product IDs");
  const cur = await c.env.DB.prepare("SELECT is_published FROM collections WHERE id = ?").bind(id).first<Row>();
  if (!cur) return bad(c, "not_found", "Collection not found", 404);
  if (ids.length) {
    const { results } = await c.env.DB.prepare(`SELECT id FROM products WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string }>();
    if (results.length !== ids.length) return bad(c, "unknown_product", "One or more products do not exist", 404);
  }
  if (cur.is_published && ids.length === 0) return bad(c, "empty_collection", "Unpublish the collection before removing all products", 409);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM collection_products WHERE collection_id = ?").bind(id),
    ...ids.map((pid, i) => c.env.DB.prepare("INSERT INTO collection_products (collection_id,product_id,position) VALUES (?,?,?)").bind(id, pid, i)),
    c.env.DB.prepare("UPDATE collections SET updated_at = ? WHERE id = ?").bind(new Date().toISOString(), id),
  ]);
  return c.json(await detail(c.env, id, origin(c.req.url)));
});

collections.put("/:id/cover", async (c) => {
  const id = c.req.param("id");
  const cur = await c.env.DB.prepare("SELECT cover_image_key FROM collections WHERE id = ?").bind(id).first<Row>();
  if (!cur) return bad(c, "not_found", "Collection not found", 404);
  const type = (c.req.header("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!IMAGE_TYPES[type]) return bad(c, "unsupported_media", "Cover must be JPEG, PNG, WebP, AVIF or GIF", 415);
  const key = await storeImage(c.env, `collections/${id}-${Date.now()}`, await c.req.arrayBuffer(), type);
  if (!key) return bad(c, "invalid_image", "Image is empty or larger than 5 MB", 413);
  await c.env.DB.prepare("UPDATE collections SET cover_image_key = ?, updated_at = ? WHERE id = ?").bind(key, new Date().toISOString(), id).run();
  await deleteImage(c.env, cur.cover_image_key);
  return c.json(await detail(c.env, id, origin(c.req.url)));
});

collections.delete("/:id/cover", async (c) => {
  const id = c.req.param("id");
  const cur = await c.env.DB.prepare("SELECT cover_image_key FROM collections WHERE id = ?").bind(id).first<Row>();
  if (!cur) return bad(c, "not_found", "Collection not found", 404);
  await c.env.DB.prepare("UPDATE collections SET cover_image_key = NULL, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
  await deleteImage(c.env, cur.cover_image_key);
  return c.json(await detail(c.env, id, origin(c.req.url)));
});

/** Admin preview: renders the public page for any collection (published or not). Not tracked. */
collections.get("/:id/preview", async (c) => {
  const d = await detail(c.env, c.req.param("id"), origin(c.req.url));
  if (!d) return bad(c, "not_found", "Collection not found", 404);
  return c.json({ html: renderCollectionPage(d, d.products.filter((p) => p.isActive), { preview: true, nonce: "preview" }) });
});
