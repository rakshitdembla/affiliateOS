import { devices } from "@playwright/test";
import { test, expect, shot, seedProduct, seedPublishedCollection } from "./fixtures";
import { API } from "./env";

const { defaultBrowserType: _ignored, ...iphone } = devices["iPhone 14"];
test.use(iphone);

test("storefront on a phone: layout, no horizontal scroll, Shop now goes to the exact affiliate URL", async ({ page, api, cspErrors }) => {
  const p1 = await seedProduct(api, "Cable Knit Sweater in Cream With a Deliberately Long Product Title That Wraps", 249900);
  const p2 = await seedProduct(api, "Wool Overcoat", 599950);
  const p3 = await seedProduct(api, "Leather Chelsea Boots");
  const col = await seedPublishedCollection(api, "Winter Outfits Under ₹2,000", [p1.id, p2.id, p3.id]);

  await page.route("https://www.amazon.in/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>stubbed affiliate destination</title>" }));
  await page.goto(`${API}/c/${col.slug}?s=youtube`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Winter Outfits Under ₹2,000");
  await expect(page.getByText("3 items")).toBeVisible();
  await expect(page.getByText("₹5,999.50")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, "09-storefront-iphone", true);

  const link = page.getByRole("link", { name: "Shop now" }).first();
  await expect(link).toHaveAttribute("href", new RegExp(`/go/${p1.id}\\?c=${col.id}&s=youtube$`));
  const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe(p1.affiliateUrl);

  const overview = await (await api.get("/api/v1/overview")).json();
  expect(overview.clicks).toBeGreaterThanOrEqual(1);
  expect(cspErrors).toEqual([]);
});

test("storefront: friendly 404s and link-preview metadata", async ({ page, api }) => {
  await page.goto(`${API}/c/no-such-collection`);
  await expect(page.getByRole("heading", { name: "Collection not found" })).toBeVisible();
  await shot(page, "10-storefront-404");

  const p = await seedProduct(api, "Preview Tee");
  const col = await seedPublishedCollection(api, "Link Preview Check", [p.id]);
  const res = await api.get(`/c/${col.slug}`, { headers: { "User-Agent": "WhatsApp/2.24.1 A" } });
  const html = await res.text();
  expect(html).toContain('<meta property="og:title" content="Link Preview Check">');
  expect(html).toContain('property="og:description"');
  expect(html).toContain(`property="og:url" content="${API}/c/${col.slug}"`);
});
