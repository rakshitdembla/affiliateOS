import { createHmac } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, shot, seedProduct, seedPublishedCollection } from "./fixtures";
import { API, E2E_IG, MOCK_META } from "./env";

const MEDIA = "18000000000000555";
let n = 0;
async function comment(api: APIRequestContext, text: string, o: { from: string; username: string; id?: string }) {
  const id = o.id ?? `1790000000009${String(++n).padStart(4, "0")}`;
  const body = JSON.stringify({ object: "instagram", entry: [{ id: "17841400000000077", time: 1795127000, changes: [{ field: "comments", value: { id, text, from: { id: o.from, username: o.username }, media: { id: MEDIA, media_product_type: "REELS" } } }] }] });
  const sig = `sha256=${createHmac("sha256", E2E_IG.META_APP_SECRET).update(body).digest("hex")}`;
  expect((await api.post("/webhooks/instagram", { data: body, headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig } })).status()).toBe(200);
  return id;
}
const sends = async (api: APIRequestContext) => (await (await api.get(`${MOCK_META}/__sends`)).json()) as { commentId: string; text: string; auth: string }[];
const statusOf = async (api: APIRequestContext, commentId: string) => {
  const { items } = await (await api.get("/api/v1/queue/jobs?limit=200")).json();
  return items.find((j: any) => j.commentId === commentId) as any;
};
async function processNow(page: Page) { await page.getByRole("button", { name: "Process now" }).click(); }

test("comment → queued job → Mac engine sends exactly one private reply through the API; failures, duplicates and pause are handled", async ({ app, api, page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem("affiliateos.engine.settings", JSON.stringify({ pollIntervalSec: 10, sendSpacingSec: 5 })));
  await api.post(`${MOCK_META}/__reset`);
  await app();

  // 1. Connect Instagram through the real OAuth callback (mock Instagram behind it).
  await page.goto("/#/instagram");
  await page.getByRole("button", { name: "Connect Instagram" }).click();
  await expect(page.getByText(/Finish signing in to Instagram in your browser/)).toBeVisible();
  const opened: string[] = await page.evaluate(() => (window as any).__opened ?? []);
  const authorize = new URL(opened.at(-1)!);
  const cb = await api.get(`/oauth/instagram/callback?code=e2e-code&state=${authorize.searchParams.get("state")}`);
  expect(await cb.text()).toContain("Connected as @e2e.creator");
  await expect(page.getByText("@e2e.creator", { exact: true })).toBeVisible({ timeout: 15_000 });

  // 2. A published collection and an automation created in the UI, picking the reel from recent media.
  const p = await seedProduct(api, "E2E Puffer Jacket", 349900);
  const col = await seedPublishedCollection(api, "E2E Winter Drop", [p.id]);
  await page.goto("/#/automations");
  await page.getByRole("button", { name: "New automation" }).click();
  const d = page.getByRole("dialog", { name: "New automation" });
  await d.getByRole("option", { name: /E2E winter reel/ }).click();
  await d.getByLabel("Collection").selectOption(col.id);
  await d.getByLabel("Keywords").fill("LINK");
  await expect(d.getByLabel("Message preview")).toContainText(`${API}/c/${col.slug}?s=instagram`);
  await shot(page, "14-automation-editor");
  await d.getByRole("button", { name: "Save automation" }).click();
  await expect(d).toBeHidden();
  await expect(page.getByRole("article", { name: "E2E winter reel" })).toContainText("Active");

  // 3. Comments arrive by webhook (as if at 4 AM, while nothing else is running).
  const ok = await comment(api, "LINK please 🙏", { from: "990001", username: "e2e_fan" });
  const dup = await comment(api, "link link", { from: "990001", username: "e2e_fan" });
  const bad = await comment(api, "LINK", { from: "990002", username: "e2e_ghost", id: "17900000000fail1" });
  const ignored = await comment(api, "love this", { from: "990003", username: "e2e_other" });
  expect((await statusOf(api, ok)).status).toBe("pending");
  expect(await statusOf(api, dup)).toMatchObject({ status: "skipped", outcome: "duplicate" });
  expect(await statusOf(api, ignored)).toBeUndefined();

  // 4. The Mac engine processes the queue.
  await page.goto("/#/queue");
  await processNow(page);
  await expect.poll(async () => (await statusOf(api, ok)).status, { timeout: 40_000 }).toBe("sent");
  await expect.poll(async () => (await statusOf(api, bad)).status, { timeout: 40_000 }).toBe("failed");
  const sent = await sends(api);
  expect(sent.filter((s) => s.commentId === ok)).toHaveLength(1);
  expect(sent.find((s) => s.commentId === ok)!.text).toBe(`Hey @e2e_fan! Here are the outfits you were looking for 👇\n\n${API}/c/${col.slug}?s=instagram`);
  expect(sent.find((s) => s.commentId === ok)!.auth).toBe("Bearer EAAe2e_system_user_token_abcdefghijklmnopqrstu");
  expect(sent.some((s) => s.commentId === dup)).toBe(false);
  expect((await statusOf(api, bad)).errorCode).toBe("recipient_not_found");
  await page.reload();
  const fanRows = page.getByRole("row", { name: "Reply to e2e_fan" });
  await expect(fanRows.filter({ hasText: "LINK please" })).toContainText("sent");
  await expect(fanRows.filter({ hasText: "link link" })).toContainText("duplicate");
  await shot(page, "15-queue-after-send");

  // 5. Pause holds new work; resume sends it.
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  const later = await comment(api, "LINK", { from: "990004", username: "e2e_late" });
  await page.waitForTimeout(12_000);
  expect((await statusOf(api, later)).status).toBe("pending");
  await page.getByRole("button", { name: "Resume" }).click();
  await expect.poll(async () => (await statusOf(api, later)).status, { timeout: 40_000 }).toBe("sent");
  expect((await sends(api)).filter((s) => s.commentId === later)).toHaveLength(1);

  // 6. Every step is visible in the logs, including why the failed one failed.
  await page.goto("/#/logs");
  await page.getByRole("button", { name: "error" }).click();
  await expect(page.getByText(/Instagram couldn't find this person/).first()).toBeVisible();
  await shot(page, "16-logs-errors");

  // The overview reflects it.
  const o = await (await api.get("/api/v1/overview")).json();
  expect(o.sentToday).toBeGreaterThanOrEqual(2);
  expect(o.failedMessages).toBeGreaterThanOrEqual(1);
});
