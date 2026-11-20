import { test, expect, shot, seedProduct, seedPublishedCollection } from "./fixtures";
import { API } from "./env";

test("analytics: real visits and clicks from the storefront show up (bots excluded) and export as CSV", async ({ app, api, page, browser }) => {
  const p = await seedProduct(api, "Analytics Trench Coat", 459900);
  const col = await seedPublishedCollection(api, "Analytics Edit", [p.id]);
  const before = await (await api.get(`/api/v1/analytics?collectionId=${col.id}&tz=330`)).json();

  // Visitor traffic on the public page: 2 human visits + 1 click from Instagram, 1 WhatsApp preview (a bot).
  const visitor = await browser.newContext();
  const v = await visitor.newPage();
  await v.route("https://www.amazon.in/**", (r) => r.fulfill({ status: 200, body: "stub" }));
  await v.goto(`${API}/c/${col.slug}?s=instagram`);
  await v.goto(`${API}/c/${col.slug}?s=youtube`);
  const [popup] = await Promise.all([v.waitForEvent("popup"), v.getByRole("link", { name: "Shop now" }).click()]);
  await popup.waitForLoadState();
  await visitor.close();
  await api.get(`/c/${col.slug}`, { headers: { "User-Agent": "WhatsApp/2.24 A" } });

  const after = await (await api.get(`/api/v1/analytics?collectionId=${col.id}&tz=330`)).json();
  expect(after.totals.visits - before.totals.visits).toBe(2);
  expect(after.totals.clicks - before.totals.clicks).toBe(1);
  expect(after.totals.botVisits - before.totals.botVisits).toBe(1);

  await app();
  await page.goto("/#/analytics");
  await page.getByLabel("Collection filter").selectOption(col.id);
  await expect(page.getByRole("group", { name: "Collection visits" })).toContainText(String(after.totals.visits));
  await expect(page.getByRole("table", { name: "Collections performance" })).toContainText("Analytics Edit");
  await expect(page.getByRole("list", { name: "Top products" })).toContainText("Analytics Trench Coat");
  await shot(page, "17-analytics");

  // In the app, exports go through the native save_export command (→ ~/Downloads, revealed in Finder).
  await page.getByRole("button", { name: /Clicks CSV/ }).click();
  await expect(page.getByText(/Exported to \/Users\/e2e\/Downloads\/affiliateos-clicks-.*\.csv/)).toBeVisible();
  const exports: { fileName: string; contents: string }[] = await page.evaluate(() => (window as any).__exports);
  expect(exports).toHaveLength(1);
  expect(exports[0]!.fileName).toMatch(/^affiliateos-clicks-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = exports[0]!.contents;
  expect(csv.split("\r\n")[0]).toBe('"time_utc","product","platform","collection","source","bot"');
  expect(csv).toContain('"Analytics Trench Coat","amazon","Analytics Edit","youtube","no"');
});
