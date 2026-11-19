import { test, expect, shot, seedProduct } from "./fixtures";
import { API } from "./env";

test("collections: create, add, reorder, publish, public page order, preview, duplicate, delete", async ({ app, api }) => {
  const [a, b, c] = [await seedProduct(api, "Pleated Trousers"), await seedProduct(api, "Oxford Shirt"), await seedProduct(api, "Suede Loafers")];
  const page = await app();
  await page.goto("/#/collections");
  await expect(page.getByText("No collections yet")).toBeVisible();

  await page.getByRole("button", { name: "New collection" }).click();
  const d = page.getByRole("dialog", { name: "New collection" });
  await d.getByLabel("Name").fill("E2E Old Money Edit");
  await d.getByLabel("Description").fill("Quiet luxury basics.");
  for (const t of ["Pleated Trousers", "Oxford Shirt", "Suede Loafers"]) await d.getByRole("button", { name: `Add ${t}` }).click();
  await d.getByRole("button", { name: "Move Suede Loafers up" }).click();
  await d.getByRole("button", { name: "Move Suede Loafers up" }).click();
  await expect(d.getByRole("list", { name: "Collection products" }).getByRole("listitem")).toHaveText([/Suede Loafers/, /Pleated Trousers/, /Oxford Shirt/]);
  await d.getByLabel(/Published/).check();
  await shot(page, "06-collection-editor");
  await d.getByRole("button", { name: "Save collection" }).click();
  await expect(d).toBeHidden();

  await expect(page.getByText("E2E Old Money Edit")).toBeVisible();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  await expect(page.getByText(/3 products · \/c\/e2e-old-money-edit/)).toBeVisible();

  // Public page reflects the saved order.
  const html = await (await api.get(`${API}/c/e2e-old-money-edit`)).text();
  const order = ["Suede Loafers", "Pleated Trousers", "Oxford Shirt"].map((t) => html.indexOf(t));
  expect(order.every((i) => i > 0)).toBe(true);
  expect([...order].sort((x, y) => x - y)).toEqual(order);
  for (const p of [a, b, c]) expect(html).toContain(`/go/${p.id}?c=`);

  await page.getByRole("button", { name: "Preview E2E Old Money Edit" }).click();
  const frame = page.frameLocator('iframe[title="Collection preview"]');
  await expect(frame.getByRole("heading", { name: "E2E Old Money Edit" })).toBeVisible();
  await expect(frame.getByText("Preview — not tracked")).toBeVisible();
  await shot(page, "07-collection-preview");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Duplicate E2E Old Money Edit" }).click();
  await expect(page.getByText("Collection duplicated as an unpublished draft.")).toBeVisible();
  await expect(page.getByText("E2E Old Money Edit (copy)")).toBeVisible();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await shot(page, "08-collections-list");

  await page.getByRole("button", { name: "Delete E2E Old Money Edit (copy)" }).click();
  await page.getByRole("dialog", { name: "Delete collection?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("E2E Old Money Edit (copy)")).toHaveCount(0);

  // Edit: remove one product.
  await page.getByRole("button", { name: "Edit E2E Old Money Edit" }).click();
  const e = page.getByRole("dialog", { name: "Edit collection" });
  await e.getByRole("button", { name: "Remove Oxford Shirt" }).click();
  await e.getByRole("button", { name: "Save collection" }).click();
  await expect(e).toBeHidden();
  await expect(page.getByText(/2 products · /)).toBeVisible();

  // Unpublish makes the public page 404.
  await page.getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  expect((await api.get(`${API}/c/e2e-old-money-edit`)).status()).toBe(404);
});

test("collections: publishing an empty collection shows the server's reason", async ({ app }) => {
  const page = await app();
  await page.goto("/#/collections");
  await page.getByRole("button", { name: "New collection" }).click();
  const d = page.getByRole("dialog", { name: "New collection" });
  await d.getByLabel("Name").fill("E2E Empty");
  await d.getByLabel(/Published/).check();
  await d.getByRole("button", { name: "Save collection" }).click();
  await expect(d.getByRole("alert")).toHaveText("Add at least one active product before publishing");
});
