import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";

const H = { Authorization: "Bearer test-token", "Content-Type": "application/json" };
const call = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...H, ...(init.headers as object) } }, env as any);
const json = (body: unknown) => ({ body: JSON.stringify(body) });
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const base = { affiliateUrl: "https://www.amazon.in/dp/B0ABCDEFGH?tag=me-21", platform: "amazon", title: "Boat Earbuds", priceMinor: 129900 };

beforeEach(async () => { await env.DB.prepare("DELETE FROM products").run(); });
afterEach(() => vi.restoreAllMocks());

describe("products API", () => {
  it("requires auth", async () => {
    expect((await app.request("/api/v1/products", {}, env as any)).status).toBe(401);
  });

  it("creates manually, preserves the affiliate URL exactly, lists and searches", async () => {
    const res = await call("/api/v1/products", { method: "POST", ...json(base) });
    expect(res.status).toBe(201);
    const p: any = await res.json();
    expect(p).toMatchObject({ affiliateUrl: base.affiliateUrl, extractionStatus: "manual", priceMinor: 129900, isActive: true, cachedImageUrl: null });
    const list: any = await (await call("/api/v1/products?search=boat")).json();
    expect(list.total).toBe(1);
    expect((await (await call("/api/v1/products?search=zzz")).json() as any).total).toBe(0);
    expect((await (await call("/api/v1/products?platform=myntra")).json() as any).total).toBe(0);
    expect((await (await call("/api/v1/products?search=%25")).json() as any).total).toBe(0); // wildcard is escaped
  });

  it("validates input and URL/platform match", async () => {
    expect((await call("/api/v1/products", { method: "POST", ...json({ ...base, title: "" }) })).status).toBe(400);
    expect((await call("/api/v1/products", { method: "POST", ...json({ ...base, platform: "myntra" }) })).status).toBe(400);
    expect((await call("/api/v1/products", { method: "POST", ...json({ ...base, affiliateUrl: "http://www.amazon.in/dp/B0ABCDEFGH" }) })).status).toBe(400);
    expect((await call("/api/v1/products", { method: "POST", body: "{bad" })).status).toBe(400);
  });

  it("rejects duplicates with 409 and the existing id", async () => {
    const first: any = await (await call("/api/v1/products", { method: "POST", ...json(base) })).json();
    const dup = await call("/api/v1/products", { method: "POST", ...json(base) });
    expect(dup.status).toBe(409);
    expect((await dup.json() as any).existingId).toBe(first.id);
  });

  it("caches the image in R2 and serves it publicly; failure to cache is non-fatal", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(PNG, { headers: { "content-type": "image/png" } }));
    const p: any = await (await call("/api/v1/products", { method: "POST", ...json({ ...base, imageUrl: "https://m.media-amazon.com/i.png" }) })).json();
    expect(p.cachedImageUrl).toMatch(/\/img\/products\/.+\.png$/);
    const img = await app.request(new URL(p.cachedImageUrl).pathname, {}, env as any); // no auth needed
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("cache-control")).toContain("immutable");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("<html>", { headers: { "content-type": "text/html" } }));
    const q: any = await (await call("/api/v1/products", { method: "POST", ...json({ ...base, affiliateUrl: "https://www.amazon.in/dp/B0ZZZZZZZZ", imageUrl: "https://m.media-amazon.com/x" }) })).json();
    expect(q.cachedImageUrl).toBeNull();
    expect(q.imageUrl).toBe("https://m.media-amazon.com/x");
  });

  it("image route rejects traversal / arbitrary keys", async () => {
    expect((await app.request("/img/../secret", {}, env as any)).status).toBe(404);
    expect((await app.request("/img/products/not-a-uuid.png", {}, env as any)).status).toBe(404);
  });

  it("patches fields, marks manual, tracks price timestamp, toggles active", async () => {
    const p: any = await (await call("/api/v1/products", { method: "POST", ...json(base) })).json();
    const r = await call(`/api/v1/products/${p.id}`, { method: "PATCH", ...json({ title: "New", priceMinor: 99900, isActive: false }) });
    const u: any = await r.json();
    expect(u).toMatchObject({ title: "New", priceMinor: 99900, isActive: false, extractionStatus: "manual" });
    expect(u.affiliateUrl).toBe(base.affiliateUrl);
    expect((await call("/api/v1/products/nope", { method: "PATCH", ...json({ title: "x" }) })).status).toBe(404);
  });

  it("extract preview returns failures as data", async () => {
    const r: any = await (await call("/api/v1/products/extract", { method: "POST", ...json({ url: "https://flipkart.com/x" }) })).json();
    expect(r.error.code).toBe("unsupported_url");
  });

  it("refresh updates only what the page provides; failure keeps data", async () => {
    const p: any = await (await call("/api/v1/products", { method: "POST", ...json(base) })).json();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("blocked", { status: 403 }));
    const r: any = await (await call(`/api/v1/products/${p.id}/refresh`, { method: "POST" })).json();
    expect(r.product).toMatchObject({ title: "Boat Earbuds", priceMinor: 129900, extractionStatus: "failed" });
    expect(r.product.extractionError).toMatch(/refused/);
  });

  it("deletes and removes the cached image", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(PNG, { headers: { "content-type": "image/png" } }));
    const p: any = await (await call("/api/v1/products", { method: "POST", ...json({ ...base, imageUrl: "https://m.media-amazon.com/i.png" }) })).json();
    expect((await call(`/api/v1/products/${p.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await call(`/api/v1/products/${p.id}`)).status).toBe(404);
    expect((await app.request(new URL(p.cachedImageUrl).pathname, {}, env as any)).status).toBe(404);
  });
});
