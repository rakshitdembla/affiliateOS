import { test, expect, shot } from "./fixtures";
import { API, E2E_TOKEN } from "./env";

test("first run: setup prompt, token verification and storage, then real (empty) overview", async ({ app }) => {
  const page = await app({ token: null });
  await page.goto("/");
  await expect(page.getByText("Backend access not configured")).toBeVisible();
  await expect(page.getByText("Healthy")).toBeVisible(); // /health is public
  await expect(page.getByRole("group", { name: "Products" })).toContainText("—"); // no fake numbers
  await shot(page, "01-overview-no-token");

  await page.getByRole("link", { name: "Open Settings" }).click();
  await page.getByLabel("API URL").fill(API);
  await page.getByPlaceholder("Paste token").fill("definitely-wrong");
  await page.getByRole("button", { name: "Save & test" }).click();
  await expect(page.getByRole("status")).toHaveText("Missing or invalid credentials");

  await page.getByPlaceholder("Paste token").fill(E2E_TOKEN);
  await page.getByRole("button", { name: "Save & test" }).click();
  await expect(page.getByRole("status")).toHaveText("Connection verified and saved.");
  await expect(page.getByText("Stored in Keychain")).toBeVisible();
  await shot(page, "02-settings-saved");

  await page.getByRole("link", { name: "Overview" }).click();
  for (const label of ["Products", "Collections", "Total clicks", "Pending DMs"]) await expect(page.getByRole("group", { name: label })).toContainText("0");
  await expect(page.getByText("Not connected")).toBeVisible();
  await expect(page.getByText(/No activity yet/)).toBeVisible();
  await expect(page.getByText("Backend access not configured")).toBeHidden();
  await shot(page, "03-overview-connected");
});

test("removing the token asks for confirmation and returns to the setup prompt", async ({ app }) => {
  const page = await app();
  await page.goto("/#/settings");
  await expect(page.getByText("Stored in Keychain")).toBeVisible();
  await page.getByRole("button", { name: "Remove token" }).click();
  await expect(page.getByRole("dialog", { name: "Remove token?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Stored in Keychain")).toBeVisible();
  await page.getByRole("button", { name: "Remove token" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Token removed.")).toBeVisible();
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByText("Backend access not configured")).toBeVisible();
});
