import { createHmac } from "node:crypto";
import { test, expect, shot } from "./fixtures";
import { API, E2E_IG } from "./env";

test("instagram: setup values, Connect opens the official login, a signed comment webhook shows up in the app", async ({ app, api }) => {
  const page = await app();
  await page.goto("/#/instagram");
  await expect(page.getByText("No account connected")).toBeVisible();
  await expect(page.getByText(`${API}/oauth/instagram/callback`)).toBeVisible();
  await expect(page.getByText(`${API}/webhooks/instagram`)).toBeVisible();
  await expect(page.getByText(/No webhook events received yet/)).toBeVisible();
  await shot(page, "12-instagram-ready");

  // Connect → the native opener is asked to open Instagram's authorize page with a single-use state.
  await page.getByRole("button", { name: "Connect Instagram" }).click();
  await expect(page.getByText(/Finish signing in to Instagram in your browser/)).toBeVisible();
  const opened: string[] = await page.evaluate(() => (window as any).__opened ?? []);
  expect(opened).toHaveLength(1);
  const u = new URL(opened[0]!);
  expect(u.origin + u.pathname).toBe("https://www.instagram.com/oauth/authorize");
  expect(u.searchParams.get("client_id")).toBe(E2E_IG.IG_APP_ID);
  expect(u.searchParams.get("redirect_uri")).toBe(`${API}/oauth/instagram/callback`);
  const state = u.searchParams.get("state")!;

  // Forged state is refused; the real state works once (here: the user cancels in the browser).
  expect((await api.get(`/oauth/instagram/callback?code=x&state=${"z".repeat(43)}`)).status()).toBe(400);
  const cancelled = await api.get(`/oauth/instagram/callback?error=access_denied&error_reason=user_denied&state=${state}`);
  expect(await cancelled.text()).toContain("Connection cancelled");
  expect((await api.get(`/oauth/instagram/callback?error=access_denied&state=${state}`)).status()).toBe(400);
  await page.getByRole("button", { name: "Stop waiting" }).click();

  // Webhook handshake and a signed delivery, exactly as Meta sends them.
  const hs = await api.get(`/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${E2E_IG.IG_WEBHOOK_VERIFY_TOKEN}&hub.challenge=987654`);
  expect(await hs.text()).toBe("987654");
  const body = JSON.stringify({ object: "instagram", entry: [{ id: "17841400000000001", time: 1795127000, changes: [{ field: "comments", value: { from: { id: "990001", username: "e2e_shopper" }, media: { id: "18000000000000123", media_product_type: "REELS" }, id: "17900000000000777", text: "LINK please" } }] }] });
  const sig = `sha256=${createHmac("sha256", E2E_IG.IG_APP_SECRET).update(body).digest("hex")}`;
  expect((await api.post("/webhooks/instagram", { data: body, headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig } })).status()).toBe(200);
  expect((await api.post("/webhooks/instagram", { data: body, headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig } })).status()).toBe(200);
  expect((await api.post("/webhooks/instagram", { data: body, headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=" + "0".repeat(64) } })).status()).toBe(401);

  await page.reload();
  await expect(page.getByText("@e2e_shopper")).toBeVisible();
  await expect(page.getByText("LINK please")).toBeVisible();
  await expect(page.getByText("(delivered 2×)")).toBeVisible();
  await shot(page, "13-instagram-event-received");

  const overview = await (await api.get("/api/v1/overview")).json();
  expect(overview.lastEventAt).not.toBeNull();
});
