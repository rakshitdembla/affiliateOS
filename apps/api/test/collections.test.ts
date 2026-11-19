import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app";

const H = { Authorization: "Bearer test-token", "Content-Type": "application/json" };
const admin = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...H, ...(init.headers as object) } }, env as any);
const pub = (path: string, ua = "Mozilla/5.0 (Macintosh) Safari") => app.request(path, { headers: { "User-Agent": ua }, redirect: "manual" }, env as any);
const body = (b: unknown) => ({ body: JSON.stringify(b) });
const AFF = "https://www.amazon.in/dp/B0ABCDEFGH?tag=me-21&ref=x%20y";

async function mkProduct(title: string, over: Record<string, unknown> = {}, aff = `https://www.amazon.in/dp/B0${Math.random().toString(36).slice(2, 10).toUpperCase()}`): Promise<any> {
  return (await admin("/api/v1/products", { method: "POST", ...body({ affiliateUrl: aff, platform: "amazon", title, priceMinor: 99900, ...over }) })).json();
}
const mkCol = async (name = "Winter Fits"): Promise<any> => (await admin("/api/v1/collections", { method: "POST", ...body({ name }) })).json();
const setProducts = (id: string, ids: string[]) => admin(`/api/v1/collections/${id}/products`, { method: "PUT", ...body({ productIds: ids }) });

beforeEach(async () => {
  for (const t of ["click_events", "collection_views", "automations", "collection_products", "collections", "products"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("collections admin API", () => {
  it("creates with generated unique slugs and validates explicit slugs", async () => {
    const a = await mkCol("Old Money Aesthetic!"), b = await mkCol("Old Money Aesthetic!");
    expect(a.slug).toBe("old-money-aesthetic");
    expect(b.slug).toBe("old-money-aesthetic-2");
    expect(a).toMatchObject({ isPublished: false, productCount: 0, publicUrl: expect.stringMatching(/\/c\/old-money-aesthetic$/) });
    expect((await admin("/api/v1/collections", { method: "POST", ...body({ name: "x", slug: "Bad Slug" }) })).status).toBe(400);
    expect((await admin("/api/v1/collections", { method: "POST", ...body({ name: "x", slug: "old-money-aesthetic" }) })).status).toBe(409);
    expect((await admin("/api/v1/collections", { method: "POST", ...body({ name: "" }) })).status).toBe(400);
  });

  it("orders products, supports reorder/remove, many-to-many, and rejects unknown/duplicate ids", async () => {
    const [p1, p2, p3] = [await mkProduct("A"), await mkProduct("B"), await mkProduct("C")];
    const c1 = await mkCol("One"), c2 = await mkCol("Two");
    let d: any = await (await setProducts(c1.id, [p3.id, p1.id, p2.id])).json();
    expect(d.products.map((p: any) => p.title)).toEqual(["C", "A", "B"]);
    d = await (await setProducts(c1.id, [p2.id, p3.id])).json();
    expect(d.products.map((p: any) => p.title)).toEqual(["B", "C"]);
    expect(d.productCount).toBe(2);
    await setProducts(c2.id, [p2.id]); // same product in two collections
    expect((await (await admin(`/api/v1/collections/${c2.id}`)).json() as any).productCount).toBe(1);
    expect((await setProducts(c1.id, [crypto.randomUUID()])).status).toBe(404);
    expect((await setProducts(c1.id, [p1.id, p1.id])).status).toBe(400);
    expect((await setProducts(crypto.randomUUID(), [])).status).toBe(404);
  });

  it("publishes only with an active product; blocks emptying a published collection", async () => {
    const c = await mkCol(), p = await mkProduct("A");
    expect((await admin(`/api/v1/collections/${c.id}`, { method: "PATCH", ...body({ isPublished: true }) })).status).toBe(409);
    await setProducts(c.id, [p.id]);
    const pubd: any = await (await admin(`/api/v1/collections/${c.id}`, { method: "PATCH", ...body({ isPublished: true, name: "Renamed" }) })).json();
    expect(pubd).toMatchObject({ isPublished: true, name: "Renamed" });
    expect((await setProducts(c.id, [])).status).toBe(409);
    expect((await (await admin(`/api/v1/collections/${c.id}`, { method: "PATCH", ...body({ isPublished: false }) })).json() as any).isPublished).toBe(false);
  });

  it("duplicates unpublished with the same products and a new slug", async () => {
    const c = await mkCol("Base"), p = await mkProduct("A");
    await setProducts(c.id, [p.id]);
    await admin(`/api/v1/collections/${c.id}`, { method: "PATCH", ...body({ isPublished: true }) });
    const dup: any = await (await admin(`/api/v1/collections/${c.id}/duplicate`, { method: "POST" })).json();
    expect(dup).toMatchObject({ name: "Base (copy)", isPublished: false, productCount: 1 });
    expect(dup.slug).not.toBe(c.slug);
  });

  it("uploads, replaces and removes a cover; rejects non-images", async () => {
    const c = await mkCol();
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const up: any = await (await admin(`/api/v1/collections/${c.id}/cover`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png })).json();
    expect(up.coverImageUrl).toMatch(/\/img\/collections\/.+\.png$/);
    expect((await pub(new URL(up.coverImageUrl).pathname)).status).toBe(200);
    expect((await admin(`/api/v1/collections/${c.id}/cover`, { method: "PUT", headers: { "Content-Type": "text/html" }, body: "<b>" })).status).toBe(415);
    const gone: any = await (await admin(`/api/v1/collections/${c.id}/cover`, { method: "DELETE" })).json();
    expect(gone.coverImageUrl).toBeNull();
    expect((await pub(new URL(up.coverImageUrl).pathname)).status).toBe(404);
  });

  it("deleting a collection used by an automation is refused", async () => {
    const c = await mkCol();
    await env.DB.prepare("INSERT INTO automations (id,media_id,reel_name,collection_id,keywords,message_template) VALUES ('a1','m','r',?,'[\"link\"]','hi')").bind(c.id).run();
    expect((await admin(`/api/v1/collections/${c.id}`, { method: "DELETE" })).status).toBe(409);
    await env.DB.prepare("DELETE FROM automations").run();
    expect((await admin(`/api/v1/collections/${c.id}`, { method: "DELETE" })).status).toBe(204);
  });

  it("admin preview renders unpublished collections and is not tracked", async () => {
    const c = await mkCol("Draft"), p = await mkProduct("A");
    await setProducts(c.id, [p.id]);
    const r: any = await (await admin(`/api/v1/collections/${c.id}/preview`)).json();
    expect(r.html).toContain("Preview");
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM collection_views").first<{ n: number }>())!.n).toBe(0);
  });
});

describe("public storefront", () => {
  async function published(title = "Safe") {
    const p = await mkProduct(title, { imageUrl: null }, AFF);
    const c = await mkCol("Winter Outfits");
    await setProducts(c.id, [p.id]);
    await admin(`/api/v1/collections/${c.id}`, { method: "PATCH", ...body({ isPublished: true, description: "Warm picks" }) });
    return { p, c };
  }

  it("404s for unknown and unpublished collections (no auth needed for published)", async () => {
    const c = await mkCol("Hidden");
    expect((await pub(`/c/${c.slug}`)).status).toBe(404);
    expect((await pub("/c/does-not-exist")).status).toBe(404);
    expect((await pub("/c/../../etc")).status).toBe(404);
  });

  it("renders SEO tags, tracked links, and hides inactive products", async () => {
    const { p, c } = await published("Wool Coat");
    const hidden = await mkProduct("Hidden Item");
    await setProducts(c.id, [p.id, hidden.id]);
    await admin(`/api/v1/products/${hidden.id}`, { method: "PATCH", ...body({ isActive: false }) });
    const res = await pub("/c/winter-outfits?s=instagram");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>Winter Outfits</title>");
    expect(html).toContain('property="og:title" content="Winter Outfits"');
    expect(html).toContain('rel="canonical"');
    expect(html).toContain("Wool Coat");
    expect(html).not.toContain("Hidden Item");
    expect(html).toContain(`/go/${p.id}?c=${c.id}&s=instagram`);
    expect(html).toContain("₹999");
    expect(res.headers.get("content-security-policy")).toMatch(/script-src 'nonce-/);
  });

  it("escapes HTML in product and collection text", async () => {
    const p = await mkProduct('<script>alert(1)</script>"x', {}, AFF);
    const c: any = await (await admin("/api/v1/collections", { method: "POST", ...body({ name: "<img src=x onerror=1>" }) })).json();
    await setProducts(c.id, [p.id]);
    await admin(`/api/v1/collections/${c.id}`, { method: "PATCH", ...body({ isPublished: true }) });
    const html = await (await pub(`/c/${c.slug}`)).text();
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<img src=x onerror=1>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("records views, flagging bots and link-preview crawlers", async () => {
    await published();
    await pub("/c/winter-outfits?s=whatsapp");
    await pub("/c/winter-outfits", "WhatsApp/2.23 A");
    await pub("/c/winter-outfits", "Googlebot/2.1");
    const rows = (await env.DB.prepare("SELECT is_bot, source FROM collection_views ORDER BY viewed_at").all<any>()).results;
    expect(rows.map((r) => r.is_bot)).toEqual([0, 1, 1]);
    expect(rows[0].source).toBe("whatsapp");
  });
});

describe("/go redirect", () => {
  it("redirects to the saved affiliate URL byte-for-byte and records the click", async () => {
    const p = await mkProduct("A", {}, AFF), c = await mkCol();
    await setProducts(c.id, [p.id]);
    const res = await pub(`/go/${p.id}?c=${c.id}&s=Instagram`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(AFF);
    const click: any = await env.DB.prepare("SELECT * FROM click_events").first();
    expect(click).toMatchObject({ product_id: p.id, collection_id: c.id, platform: "amazon", source: "instagram", is_bot: 0 });
  });

  it("ignores a collection the product is not in, and ignores any redirect-like params", async () => {
    const p = await mkProduct("A", {}, AFF), other = await mkCol("Other");
    const res = await pub(`/go/${p.id}?c=${other.id}&url=https://evil.example&redirect=https://evil.example`);
    expect(res.headers.get("location")).toBe(AFF);
    expect((await env.DB.prepare("SELECT collection_id FROM click_events").first<any>())!.collection_id).toBeNull();
  });

  it("404s for inactive, unknown, or malformed ids and records nothing", async () => {
    const p = await mkProduct("A", {}, AFF);
    await admin(`/api/v1/products/${p.id}`, { method: "PATCH", ...body({ isActive: false }) });
    expect((await pub(`/go/${p.id}`)).status).toBe(404);
    expect((await pub(`/go/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await pub("/go/not-a-uuid")).status).toBe(404);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM click_events").first<{ n: number }>())!.n).toBe(0);
  });

  it("flags bot clicks, which the overview excludes", async () => {
    const p = await mkProduct("A", {}, AFF);
    await pub(`/go/${p.id}`);
    await pub(`/go/${p.id}`, "facebookexternalhit/1.1");
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM click_events WHERE is_bot=1").first<{ n: number }>())!.n).toBe(1);
    const o: any = await (await admin("/api/v1/overview")).json();
    expect(o.clicks).toBe(1);
  });
});
