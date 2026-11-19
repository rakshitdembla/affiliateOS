import { afterEach, describe, expect, it, vi } from "vitest";
import { extractProduct } from "../src/extract";
import { parsePriceMinor } from "../src/extract/html";
import { detectPlatform, parseSafeUrl, validateAffiliateUrl } from "../src/extract/url";

const page = (html: string, init: ResponseInit = {}) => new Response(html, { status: 200, headers: { "content-type": "text/html" }, ...init });
afterEach(() => vi.restoreAllMocks());

describe("url safety", () => {
  it.each(["http://amazon.in/dp/B0ABCDEFGH", "https://127.0.0.1/x", "https://localhost/x", "https://user:pw@amazon.in/", "https://amazon.in:8443/", "ftp://amazon.in", "nonsense"])(
    "rejects %s", (u) => expect(parseSafeUrl(u)).toBeNull());
  it("detects platforms incl. short links and subdomains", () => {
    const p = (u: string) => detectPlatform(new URL(u));
    expect(p("https://www.amazon.in/dp/B0ABCDEFGH")).toBe("amazon");
    expect(p("https://amzn.to/abc")).toBe("amazon");
    expect(p("https://myntr.it/abc")).toBe("myntra");
    expect(p("https://www.meesho.com/x/p/1abc")).toBe("meesho");
    expect(p("https://evil-amazon.in/x")).toBeNull();
    expect(p("https://amazon.in.evil.com/x")).toBeNull();
  });
  it("validates affiliate url against platform", () => {
    expect(validateAffiliateUrl("https://www.amazon.in/dp/B0ABCDEFGH?tag=x-21", "amazon")).not.toBeNull();
    expect(validateAffiliateUrl("https://www.amazon.in/dp/B0ABCDEFGH", "myntra")).toBeNull();
  });
});

describe("price parsing", () => {
  it.each([["₹1,299", 129900], ["1,29,999.50", 12999950], [499, 49900], ["Free", null], ["", null], [0, null]])("%s", (i, o) => expect(parsePriceMinor(i)).toBe(o));
});

const LD = (extra = "") => `<html><head><title>x</title><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "Roadster Men Jacket", description: "Warm &amp; cosy", image: ["https://img.example.com/a.jpg"], offers: { "@type": "Offer", price: "1499", priceCurrency: "INR", availability: "https://schema.org/InStock" } })}</script>${extra}</head><body></body></html>`;

describe("adapters", () => {
  it("myntra: JSON-LD → success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(page(LD('<link rel="canonical" href="https://www.myntra.com/jackets/roadster/123/buy">')));
    const r = await extractProduct("https://www.myntra.com/jackets/roadster/123/buy?utm=abc");
    expect(r).toMatchObject({ platform: "myntra", status: "success", missing: [], error: null });
    expect(r.fields).toMatchObject({ title: "Roadster Men Jacket", priceMinor: 149900, currency: "INR", imageUrl: "https://img.example.com/a.jpg", description: "Warm & cosy" });
  });
  it("meesho: Open Graph only, price missing → partial, never invented", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(page(`<head><meta property="og:title" content="Floral Kurti | Buy Online - Meesho"><meta content="/i.jpg" property="og:image"></head>`));
    const r = await extractProduct("https://www.meesho.com/floral-kurti/p/abc123");
    expect(r.status).toBe("partial");
    expect(r.missing).toEqual(["price"]);
    expect(r.fields.priceMinor).toBeNull();
    expect(r.fields.title).toBe("Floral Kurti");
    expect(r.fields.imageUrl).toBe("https://www.meesho.com/i.jpg");
  });
  it("amazon: DOM fallbacks and canonical ASIN", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(page(`<span id="productTitle"> Boat Earbuds </span><span class="a-price-whole">1,299</span><span class="a-price-fraction">00</span><img id="landingImage" src="x" data-old-hires="https://m.media-amazon.com/i.jpg">`));
    const r = await extractProduct("https://www.amazon.in/Boat-Earbuds/dp/B0ABCDEFGH/ref=sr_1_1?tag=me-21");
    expect(r.status).toBe("success");
    expect(r.fields).toMatchObject({ title: "Boat Earbuds", priceMinor: 129900, canonicalUrl: "https://www.amazon.in/dp/B0ABCDEFGH" });
  });
  it("amazon: image fallbacks (hiRes JSON, dynamic-image attribute)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(page(`<span id="productTitle">A</span>"hiRes":"https://m.media-amazon.com/images/I/h.jpg"`));
    expect((await extractProduct("https://www.amazon.in/dp/B0ABCDEFGH")).fields.imageUrl).toBe("https://m.media-amazon.com/images/I/h.jpg");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(page(`<span id="productTitle">A</span><img id="landingImage" data-a-dynamic-image="{&quot;https://m.media-amazon.com/images/I/d.jpg&quot;:[342,342]}">`));
    expect((await extractProduct("https://www.amazon.in/dp/B0ABCDEFGH")).fields.imageUrl).toBe("https://m.media-amazon.com/images/I/d.jpg");
  });
  it("flags unavailable product", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(page(`<span id="productTitle">Thing</span> Currently unavailable.`));
    expect((await extractProduct("https://www.amazon.in/dp/B0ABCDEFGH")).error?.code).toBe("product_unavailable");
  });
  it("no readable title → parse_failed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(page("<html><body>hello</body></html>"));
    expect((await extractProduct("https://www.meesho.com/p/abc")).error?.code).toBe("parse_failed");
  });
});

describe("fetch behaviour & errors", () => {
  it("unsupported / invalid URLs never hit the network", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    expect((await extractProduct("https://flipkart.com/x")).error?.code).toBe("unsupported_url");
    expect((await extractProduct("not a url")).error?.code).toBe("invalid_url");
    expect(f).not.toHaveBeenCalled();
  });
  it("follows safe short-link redirects and detects the final platform", async () => {
    const f = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://www.amazon.in/dp/B0ABCDEFGH" } }))
      .mockResolvedValueOnce(page(`<span id="productTitle">Boat</span>`));
    const r = await extractProduct("https://amzn.to/abc");
    expect(r.platform).toBe("amazon");
    expect(r.finalUrl).toBe("https://www.amazon.in/dp/B0ABCDEFGH");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("refuses redirects off the supported platforms", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example.com/" } }));
    expect((await extractProduct("https://amzn.to/abc")).error?.code).toBe("redirect_unresolved");
  });
  it("reports 403 and captcha pages as blocked (no evasion)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("no", { status: 403 }));
    expect((await extractProduct("https://www.myntra.com/a/1/buy")).error?.code).toBe("extraction_blocked");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(page("<h4>Enter the characters you see below</h4> Robot Check captcha"));
    expect((await extractProduct("https://www.amazon.in/dp/B0ABCDEFGH")).error?.code).toBe("extraction_blocked");
  });
  it("network failure → site_unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    expect((await extractProduct("https://www.meesho.com/p/abc")).error?.code).toBe("site_unreachable");
  });
});
