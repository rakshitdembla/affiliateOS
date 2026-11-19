import { test, expect, shot } from "./fixtures";

test("products: explains unsupported links, manual add, edit, search, deactivate, delete", async ({ app }) => {
  const page = await app();
  await page.goto("/#/products");
  await expect(page.getByText("No products yet")).toBeVisible();

  await page.getByRole("button", { name: "Add product" }).click();
  const dialog = page.getByRole("dialog", { name: "Add product" });
  await dialog.getByLabel("Affiliate URL").fill("https://www.flipkart.com/some-shirt/p/itm123");
  await dialog.getByRole("button", { name: "Fetch details" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Only Amazon, Myntra and Meesho links are supported.");
  await shot(page, "04-add-product-unsupported");

  await dialog.getByLabel("Affiliate URL").fill("https://www.amazon.in/dp/B0E2ELINEN?tag=e2e-21");
  await expect(dialog.getByRole("alert")).toBeHidden(); // stale result cleared when the URL changes
  await dialog.getByLabel("Title").fill("E2E Linen Shirt");
  await dialog.getByLabel("Price").fill("1,299");
  await dialog.getByRole("button", { name: "Save product" }).click();
  await expect(dialog).toBeHidden();

  const card = page.getByRole("article", { name: "E2E Linen Shirt" });
  await expect(card).toContainText("₹1,299");
  await expect(card).toContainText("Amazon");
  await expect(card.getByText("Manual")).toBeVisible();
  await expect(page.getByText("1 product")).toBeVisible();

  await page.getByRole("button", { name: "Edit E2E Linen Shirt" }).click();
  const edit = page.getByRole("dialog", { name: "Edit product" });
  await edit.getByLabel("Title").fill("E2E Linen Shirt (White)");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("E2E Linen Shirt (White)")).toBeVisible();

  await page.getByLabel("Search products").fill("zzz");
  await expect(page.getByText("No products match your filters")).toBeVisible();
  await page.getByLabel("Search products").fill("linen");
  await expect(page.getByText("E2E Linen Shirt (White)")).toBeVisible();
  await page.getByLabel("Search products").fill("");

  await page.getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByRole("article", { name: "E2E Linen Shirt (White)" }).getByText("Inactive", { exact: true })).toBeVisible();
  await page.getByLabel("Filter status").selectOption("active");
  await expect(page.getByText("No products match your filters")).toBeVisible();
  await page.getByLabel("Filter status").selectOption("");
  await shot(page, "05-products-list");

  await page.getByRole("button", { name: "Delete E2E Linen Shirt (White)" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete product?" });
  await expect(confirm).toContainText("will be removed permanently");
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Product deleted.")).toBeVisible();
  await expect(page.getByText("No products yet")).toBeVisible();
});

test("products: duplicate affiliate URL is reported clearly", async ({ app }) => {
  const page = await app();
  await page.goto("/#/products");
  for (const attempt of [1, 2]) {
    await page.getByRole("button", { name: "Add product" }).click();
    const d = page.getByRole("dialog", { name: "Add product" });
    await d.getByLabel("Affiliate URL").fill("https://www.amazon.in/dp/B0E2EDUPE1?tag=e2e-21");
    await d.getByText("Enter details manually instead").click();
    await d.getByLabel("Title").fill(`Dupe ${attempt}`);
    await d.getByRole("button", { name: "Save product" }).click();
    if (attempt === 2) {
      await expect(d.getByRole("alert")).toHaveText("This affiliate URL is already saved.");
      await d.getByRole("button", { name: "Cancel" }).click();
    }
  }
  await expect(page.getByText("Dupe 1")).toBeVisible();
  await expect(page.getByText("Dupe 2")).toHaveCount(0);
});
