import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { csvCell } from "../src/analytics";

const H = { Authorization: "Bearer test-token", "Content-Type": "application/json" };
const admin = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...H, ...(init.headers as object) } }, env as any);
const db = env.DB;

async function seed() {
  const p1 = await (await admin("/api/v1/products", { method: "POST", body: JSON.stringify({ affiliateUrl: "https://www.amazon.in/dp/B0ANALYT01", platform: "amazon", title: "Coat" }) })).json<any>();
  const p2 = await (await admin("/api/v1/products", { method: "POST", body: JSON.stringify({ affiliateUrl: "https://www.myntra.com/x/1/buy", platform: "myntra", title: "=HYPERLINK(\"evil\")" }) })).json<any>();
  const c = await (await admin("/api/v1/collections", { method: "POST", body: JSON.stringify({ name: "Winter" }) })).json<any>();
  const ins = (table: string, cols: string, vals: unknown[]) => db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${vals.map(() => "?").join(",")})`).bind(...vals).run();
  // 2026-11-10 20:00 UTC = 2026-11-11 01:30 in India (+330)
  const t1 = "2026-11-10T20:00:00.000Z", t2 = "2026-11-12T08:00:00.000Z";
  for (const [id, t, bot, src] of [["v1", t1, 0, "instagram"], ["v2", t2, 0, "youtube"], ["v3", t2, 1, null]] as const) await ins("collection_views", "id, collection_id, source, is_bot, viewed_at", [id, c.id, src, bot, t]);
  for (const [id, pid, plat, t, bot, src] of [["k1", p1.id, "amazon", t1, 0, "instagram"], ["k2", p1.id, "amazon", t2, 0, null], ["k3", p2.id, "myntra", t2, 0, "youtube"], ["k4", p1.id, "amazon", t2, 1, null]] as const)
    await ins("click_events", "id, product_id, collection_id, platform, source, is_bot, clicked_at", [id, pid, c.id, plat, src, bot, t]);
  await ins("dm_jobs", "id, comment_id, media_id, collection_id, message, status, received_at, sent_at", ["j1", "cm1", "m", c.id, "hi", "sent", t1, t1]);
  await ins("dm_jobs", "id, comment_id, media_id, collection_id, message, status, received_at, updated_at", ["j2", "cm2", "m", c.id, "hi", "failed", t2, t2]);
  await ins("dm_jobs", "id, comment_id, media_id, collection_id, message, status, received_at", ["j3", "cm3", "m", c.id, "hi", "skipped", t2]);
  await ins("webhook_events", "id, dedupe_key, event_type, payload, signature_ok, process_status, received_at", ["w1", "comment:1", "comments", "{}", 1, "queued", t1]);
  return { c, p1 };
}

beforeEach(async () => {
  for (const t of ["click_events", "collection_views", "dm_attempts", "dm_jobs", "webhook_events", "collection_products", "collections", "products"]) await db.prepare(`DELETE FROM ${t}`).run();
});

describe("analytics", () => {
  const range = "from=2026-11-01T00:00:00.000Z&to=2026-11-15T00:00:00.000Z";
  it("counts human traffic only (bots reported separately), messages, and success rate", async () => {
    await seed();
    const a: any = await (await admin(`/api/v1/analytics?${range}`)).json();
    expect(a.totals).toMatchObject({ visits: 2, clicks: 3, botVisits: 1, botClicks: 1, comments: 1, messagesSent: 1, messagesFailed: 1, messagesSkipped: 1, successRate: 0.5, products: 2 });
    expect(a.byPlatform).toEqual([{ key: "amazon", label: "Amazon", clicks: 2 }, { key: "myntra", label: "Myntra", clicks: 1 }]);
    expect(a.byCollection[0]).toMatchObject({ label: "Winter", clicks: 3, visits: 2, ctr: 1.5 });
    expect(a.bySource.find((s: any) => s.key === "instagram")).toMatchObject({ clicks: 1, visits: 1 });
    expect(a.bySource.find((s: any) => s.key === "direct")).toMatchObject({ clicks: 1, visits: 0 });
    expect(a.topProducts[0]).toMatchObject({ label: "Coat", clicks: 2 });
  });

  it("groups days in the viewer's timezone and zero-fills the range", async () => {
    await seed();
    const utc: any = await (await admin(`/api/v1/analytics?${range}&tz=0`)).json();
    const ist: any = await (await admin(`/api/v1/analytics?${range}&tz=330`)).json();
    expect(utc.daily.find((d: any) => d.day === "2026-11-10").clicks).toBe(1);
    expect(ist.daily.find((d: any) => d.day === "2026-11-11").clicks).toBe(1);
    expect(ist.daily.find((d: any) => d.day === "2026-11-10").clicks).toBe(0);
    expect(utc.daily.length).toBe(15);
    expect(utc.daily.reduce((s: number, d: any) => s + d.clicks, 0)).toBe(3);
  });

  it("filters by collection and validates the range", async () => {
    await seed();
    const other = await (await admin("/api/v1/collections", { method: "POST", body: JSON.stringify({ name: "Other" }) })).json<any>();
    const a: any = await (await admin(`/api/v1/analytics?${range}&collectionId=${other.id}`)).json();
    expect(a.totals).toMatchObject({ visits: 0, clicks: 0, comments: 0 });
    const own: any = await (await admin(`/api/v1/analytics?${range}&collectionId=${(await db.prepare("SELECT id FROM collections WHERE name = 'Winter'").first<any>()).id}`)).json();
    expect(own.totals.comments).toBe(3); // comments that became jobs for this collection, not account-wide comments
    expect((await admin("/api/v1/analytics?from=2026-11-10T00:00:00Z&to=2026-11-01T00:00:00Z")).status).toBe(400);
    expect((await admin("/api/v1/analytics?from=2020-01-01T00:00:00Z&to=2026-11-01T00:00:00Z")).status).toBe(400);
  });

  it("exports CSV safely (quoted, formula injection neutralised)", async () => {
    await seed();
    const res = await admin(`/api/v1/analytics/export?type=clicks&${range}`);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("affiliateos-clicks-2026-11-01-to-2026-11-15.csv");
    const csv = await res.text();
    expect(csv.split("\r\n")[0]).toBe('"time_utc","product","platform","collection","source","bot"');
    expect(csv).toContain(`"'=HYPERLINK(""evil"")"`);
    expect(csv.trim().split("\r\n")).toHaveLength(5);
    for (const t of ["daily", "visits", "messages"]) expect((await admin(`/api/v1/analytics/export?type=${t}&${range}`)).status).toBe(200);
    expect((await admin(`/api/v1/analytics/export?type=nope&${range}`)).status).toBe(400);
    expect(csvCell("-1")).toBe(`"'-1"`);
    expect(csvCell(42)).toBe('"42"');
  });

  it("requires auth", async () => {
    expect((await app.request("/api/v1/analytics", {}, env as any)).status).toBe(401);
  });
});
