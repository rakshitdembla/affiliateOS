import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";
import { encryptSecret, toHex } from "../src/crypto";
import { claimJobs, recoverStaleJobs, releaseJobs, sendJob } from "../src/queue/engine";
import { ingestEvents } from "../src/queue/ingest";
import { backoffSeconds, DEFAULT_POLICY } from "../src/queue/policy";
import { runScheduled } from "../src/scheduled";

const E: any = env;
const BASE = "https://aos.example";
const IG_ID = "17841400000000001";
const TOKEN = "IGAAqueue_token_abcdefghijklmnopqrstuvwxyz0123";
const W1 = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const MEDIA = "18000000000000123";
const H = { Authorization: "Bearer test-token", "Content-Type": "application/json" };
const enc = new TextEncoder();
const admin = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...H, ...(init.headers as object) } }, env as any);
const post = (path: string, body: unknown = {}) => admin(path, { method: "POST", body: JSON.stringify(body) });
const db = env.DB;
const one = <T = any>(sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).first<T>();
const all = <T = any>(sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).all<T>().then((r) => r.results);

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(E.IG_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body))));
}
let commentSeq = 0;
async function comment(text: string, o: { from?: string; username?: string; media?: string; id?: string } = {}) {
  const id = o.id ?? `1790000000000${String(++commentSeq).padStart(4, "0")}`;
  const body = JSON.stringify({ object: "instagram", entry: [{ id: IG_ID, time: 1795127000, changes: [{ field: "comments", value: { id, text, from: { id: o.from ?? "990001", username: o.username ?? "shopper_1" }, media: { id: o.media ?? MEDIA, media_product_type: "REELS" } } }] }] });
  const res = await app.request("/webhooks/instagram", { method: "POST", body, headers: { "Content-Type": "application/json", "X-Hub-Signature-256": await sign(body) } }, env as any);
  expect(res.status).toBe(200);
  return id;
}
const jobFor = (commentId: string) => one("SELECT * FROM dm_jobs WHERE comment_id = ?", commentId);

async function seed(o: { published?: boolean; connected?: boolean; active?: boolean; template?: string; keywords?: string[]; matchMode?: string } = {}) {
  const p = await (await post("/api/v1/products", { affiliateUrl: `https://www.amazon.in/dp/B0SEED${String(Math.random()).slice(2, 6)}`, platform: "amazon", title: "Seed product", priceMinor: 99900 })).json<any>();
  const col = await (await post("/api/v1/collections", { name: "Winter Fits" })).json<any>();
  await admin(`/api/v1/collections/${col.id}/products`, { method: "PUT", body: JSON.stringify({ productIds: [p.id] }) });
  if (o.published !== false) await admin(`/api/v1/collections/${col.id}`, { method: "PATCH", body: JSON.stringify({ isPublished: true }) });
  if (o.connected !== false) {
    await db.prepare("INSERT INTO instagram_accounts (id, ig_user_id, app_scoped_id, username, access_token_enc, token_expires_at, connected_at, status) VALUES ('acc', ?, '990', 'trendism.in', ?, ?, ?, 'connected')")
      .bind(IG_ID, await encryptSecret(TOKEN, E.TOKEN_ENCRYPTION_KEY, IG_ID), new Date(Date.now() + 50 * 86_400_000).toISOString(), new Date().toISOString()).run();
  }
  const res = await post("/api/v1/automations", { mediaId: MEDIA, reelName: "Winter reel", collectionId: col.id, keywords: o.keywords ?? ["LINK", "price"], matchMode: o.matchMode ?? "word", messageTemplate: o.template ?? "Hey [USERNAME]! [COLLECTION_NAME]: [COLLECTION_URL]", isActive: o.active ?? true });
  expect(res.status, await res.clone().text()).toBe(201);
  return { product: p, collection: col, automation: await res.json<any>() };
}

type Route = [RegExp, (url: URL, init?: RequestInit) => Response | Promise<Response>];
function mockInstagram(routes: Route[]) {
  const calls: { url: URL; init?: RequestInit; body: any }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    calls.push({ url, init, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    for (const [re, fn] of routes) if (re.test(url.toString())) return fn(url, init);
    throw new Error(`unexpected fetch ${url}`);
  });
  return calls;
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const MESSAGES = /graph\.instagram\.com\/v27\.0\/17841400000000001\/messages$/;
const graphError = (code: number, subcode?: number, status = 400, headers: Record<string, string> = {}) => json({ error: { message: `err ${code}/${subcode ?? "-"}`, type: "OAuthException", code, error_subcode: subcode, fbtrace_id: "x" } }, status, headers);

async function claimAndSend(commentId: string, policy?: object) {
  const jobs = await claimJobs(E, W1, 10);
  const job = jobs.find((j) => j.commentId === commentId)!;
  expect(job).toBeTruthy();
  const r = await sendJob(E, BASE, job.id, W1, policy);
  await releaseJobs(E, W1); // like the engine: give back claims it didn't use
  return r;
}

beforeEach(async () => {
  for (const t of ["dm_attempts", "dm_jobs", "webhook_events", "automations", "instagram_accounts", "collection_products", "collections", "products", "app_logs", "engine_heartbeats"]) await db.prepare(`DELETE FROM ${t}`).run();
});
afterEach(() => vi.restoreAllMocks());

describe("automations API", () => {
  it("validates configuration and refuses to activate with a dead link or an invalid template", async () => {
    const { collection } = await seed({ published: false, active: false });
    const base = { mediaId: MEDIA, reelName: "R", collectionId: collection.id, keywords: ["link"], messageTemplate: "[COLLECTION_URL]" };
    const r1 = await post("/api/v1/automations", { ...base, isActive: true });
    expect(r1.status).toBe(400);
    expect((await r1.json<any>()).errors.join()).toMatch(/Publish the collection/);
    expect((await post("/api/v1/automations", { ...base, messageTemplate: "Hi!" })).status).toBe(400);
    expect((await post("/api/v1/automations", { ...base, messageTemplate: "[COLLECTION_URL] [PRICE]" })).status).toBe(400);
    expect((await post("/api/v1/automations", { ...base, mediaId: "abc" })).status).toBe(400);
    expect((await post("/api/v1/automations", { ...base, keywords: [" ", ","] })).status).toBe(400);
  });

  it("normalises keywords, reports overlaps, and tracks stats", async () => {
    const { automation, collection } = await seed({ keywords: ["LINK", "link ", "Price"] });
    expect(automation.keywords).toEqual(["link", "price"]);
    expect(automation.stats).toEqual({ matched: 0, sent: 0, pending: 0, failed: 0 });
    const second = await (await post("/api/v1/automations", { mediaId: MEDIA, reelName: "Dup", collectionId: collection.id, keywords: ["link"], messageTemplate: "[COLLECTION_URL]", isActive: true })).json<any>();
    expect(second.warnings.join()).toMatch(/also a trigger on this post/);
    await comment("link");
    const list = await (await admin("/api/v1/automations")).json<any>();
    expect(list.items.find((a: any) => a.id === automation.id).stats).toMatchObject({ matched: 1, pending: 1 });
  });

  it("deleting an automation keeps already-queued jobs and their messages", async () => {
    const { automation } = await seed();
    const c = await comment("LINK please");
    expect((await admin(`/api/v1/automations/${automation.id}`, { method: "DELETE" })).status).toBe(204);
    const job = await jobFor(c);
    expect(job).toMatchObject({ automation_id: null, status: "pending" });
    expect(job.message).toContain("/c/winter-fits?s=instagram");
  });
});

describe("comment → job ingestion", () => {
  it("creates one pending job per matching comment with the rendered message and links the event", async () => {
    await seed();
    const c = await comment("Can I get the LINK? 🙏", { username: "asha" });
    const job = await jobFor(c);
    expect(job).toMatchObject({ status: "pending", media_id: MEDIA, recipient_ref: "990001", recipient_username: "asha", message: `Hey @asha! Winter Fits: ${BASE}/c/winter-fits?s=instagram` });
    const ev = await one("SELECT process_status, job_id FROM webhook_events WHERE comment_id = ?", c);
    expect(ev).toEqual({ process_status: "queued", job_id: job.id });
    expect((await one("SELECT last_run_at FROM automations")).last_run_at).not.toBeNull();
  });

  it("records why comments are not turned into jobs", async () => {
    await seed({ keywords: ["link"] });
    const reasons = async (id: string) => (await one("SELECT error FROM webhook_events WHERE comment_id = ?", id)).error;
    expect(await reasons(await comment("love this reel"))).toBe("Comment didn't match the trigger keywords");
    expect(await reasons(await comment("link", { media: "18000000000000999" }))).toBe("No active automation for this post");
    expect(await reasons(await comment("link", { username: "TRENDISM.IN", from: "123" }))).toBe("Comment by your own account");
    expect(await one("SELECT COUNT(*) n FROM dm_jobs")).toEqual({ n: 0 });
  });

  it("sends one reply per person per post: repeats are marked duplicate, other people still get theirs", async () => {
    await seed();
    const a1 = await comment("link", { from: "111", username: "a" });
    const a2 = await comment("LINK pls", { from: "111", username: "a" });
    const b1 = await comment("link", { from: "222", username: "b" });
    expect((await jobFor(a1)).status).toBe("pending");
    expect(await jobFor(a2)).toMatchObject({ status: "skipped", outcome: "duplicate", error_code: "duplicate" });
    expect((await jobFor(b1)).status).toBe("pending");
  });

  it("is idempotent under redelivery and concurrent processing", async () => {
    await seed({ connected: false });
    await db.prepare("INSERT INTO webhook_events (id, dedupe_key, event_type, payload, signature_ok, process_status, media_id, comment_id, from_id, from_username, comment_text) VALUES ('e1','comment:c-x','comments','{}',1,'received',?, 'c-x','555','z','LINK')").bind(MEDIA).run();
    const [r1, r2] = await Promise.all([ingestEvents(E, BASE), ingestEvents(E, BASE)]);
    expect(r1.created + r2.created).toBe(1);
    expect(await one("SELECT COUNT(*) n FROM dm_jobs")).toEqual({ n: 1 });
  });

  it("queues a skipped job (not a dead link) when the collection was unpublished after activation", async () => {
    const { collection } = await seed();
    await admin(`/api/v1/collections/${collection.id}`, { method: "PATCH", body: JSON.stringify({ isPublished: false }) });
    expect(await jobFor(await comment("link"))).toMatchObject({ status: "skipped", error_code: "collection_unavailable" });
  });
});

describe("claiming and recovery", () => {
  it("two engines claiming at once never get the same job", async () => {
    await seed();
    for (let i = 0; i < 6; i++) await comment("link", { from: `p${i}`, username: `u${i}` });
    const [a, b] = await Promise.all([claimJobs(E, W1, 4), claimJobs(E, W2, 4)]);
    const ids = [...a, ...b].map((j) => j.id);
    expect(ids.length).toBe(6);
    expect(new Set(ids).size).toBe(6);
    expect(await one("SELECT COUNT(*) n FROM dm_jobs WHERE status = 'processing'")).toEqual({ n: 6 });
  });

  it("claims oldest first and respects next_retry_at", async () => {
    await seed();
    const c1 = await comment("link", { from: "1" });
    const c2 = await comment("link", { from: "2" });
    await db.prepare("UPDATE dm_jobs SET next_retry_at = ? WHERE comment_id = ?").bind(new Date(Date.now() + 600_000).toISOString(), c1).run();
    const jobs = await claimJobs(E, W1, 10);
    expect(jobs.map((j) => j.commentId)).toEqual([c2]);
  });

  it("returns abandoned claims to the queue, and marks interrupted sends uncertain", async () => {
    await seed();
    const c1 = await comment("link", { from: "1" });
    const c2 = await comment("link", { from: "2" });
    await claimJobs(E, W1, 10);
    const past = new Date(Date.now() - 1000).toISOString();
    await db.prepare("UPDATE dm_jobs SET claim_expires_at = ?").bind(past).run();
    await db.prepare("UPDATE dm_jobs SET send_started_at = ? WHERE comment_id = ?").bind(past, c2).run();
    const r = await recoverStaleJobs(E);
    expect(r).toMatchObject({ released: 1, uncertain: 1 });
    expect((await jobFor(c1)).status).toBe("pending");
    expect(await jobFor(c2)).toMatchObject({ status: "uncertain", error_code: "outcome_unknown" });
  });

  it("release returns this engine's unstarted claims only", async () => {
    await seed();
    await comment("link", { from: "1" });
    await claimJobs(E, W1, 10);
    expect((await (await post("/api/v1/queue/release", { workerId: W2 })).json<any>()).released).toBe(0);
    expect((await (await post("/api/v1/queue/release", { workerId: W1 })).json<any>()).released).toBe(1);
  });

  it("skips pending jobs that passed Instagram's 7-day window", async () => {
    await seed();
    const c = await comment("link");
    await db.prepare("UPDATE dm_jobs SET received_at = ?").bind(new Date(Date.now() - 8 * 86_400_000).toISOString()).run();
    await recoverStaleJobs(E);
    expect(await jobFor(c)).toMatchObject({ status: "skipped", error_code: "window_expired" });
  });
});

describe("sending", () => {
  it("sends exactly the rendered reply to the comment with the server-held token, and records everything", async () => {
    await seed();
    const c = await comment("link", { username: "asha" });
    const calls = mockInstagram([[MESSAGES, () => json({ recipient_id: "990001", message_id: "aWdfZmFrZQ" })]]);
    const r = await claimAndSend(c);
    expect(r.body.outcome).toBe("sent");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ recipient: { comment_id: c }, message: { text: `Hey @asha! Winter Fits: ${BASE}/c/winter-fits?s=instagram` } });
    expect((calls[0]!.init!.headers as any).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(await jobFor(c)).toMatchObject({ status: "sent", outcome: "sent", meta_message_id: "aWdfZmFrZQ", attempt_count: 1, claimed_by: null });
    expect(await all("SELECT outcome, worker_id FROM dm_attempts")).toEqual([{ outcome: "sent", worker_id: W1 }]);
    expect(JSON.stringify(await all("SELECT message FROM app_logs"))).not.toContain(TOKEN);
  });

  it("can never send twice: a repeated or foreign send request is refused without calling Instagram", async () => {
    await seed();
    const c = await comment("link");
    const calls = mockInstagram([[MESSAGES, () => json({ recipient_id: "1", message_id: "m1" })]]);
    const [job] = await claimJobs(E, W1, 1);
    expect((await sendJob(E, BASE, job!.id, W2, undefined)).status).toBe(409);
    const [a, b] = await Promise.all([sendJob(E, BASE, job!.id, W1, undefined), sendJob(E, BASE, job!.id, W1, undefined)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await sendJob(E, BASE, job!.id, W1, undefined)).status).toBe(409);
    expect(calls).toHaveLength(1);
    expect((await jobFor(c)).attempt_count).toBe(1);
  });

  it.each([
    ["network error / timeout", () => { throw new Error("socket hang up"); }],
    ["non-JSON 502 from a gateway", () => new Response("<html>bad gateway</html>", { status: 502 })],
    ["200 without a message id", () => json({ ok: true })],
  ])("marks the outcome uncertain on %s and never retries it automatically", async (_n, handler) => {
    await seed();
    const c = await comment("link");
    mockInstagram([[MESSAGES, handler as any]]);
    expect((await claimAndSend(c)).body.outcome).toBe("uncertain");
    expect(await jobFor(c)).toMatchObject({ status: "uncertain", outcome: "uncertain", error_code: "outcome_unknown" });
    expect(await claimJobs(E, W1, 10)).toHaveLength(0);
  });

  it("rate limits: requeues with Instagram's suggested wait and tells the engine to cool down", async () => {
    await seed();
    const c = await comment("link");
    mockInstagram([[MESSAGES, () => graphError(613, undefined, 400, { "x-business-use-case-usage": JSON.stringify({ "1": [{ type: "instagram", call_count: 100, estimated_time_to_regain_access: 30 }] }) })]]);
    const r = await claimAndSend(c);
    expect(r.body).toMatchObject({ outcome: "rate_limited" });
    expect(r.body.retryAfterSeconds).toBeGreaterThanOrEqual(1800);
    const job = await jobFor(c);
    expect(job).toMatchObject({ status: "pending", error_code: "rate_limited", send_started_at: null });
    expect(Date.parse(job.next_retry_at) - Date.now()).toBeGreaterThan(29 * 60_000);
  });

  it("temporary errors back off and give up after the configured attempts", async () => {
    await seed();
    const c = await comment("link");
    mockInstagram([[MESSAGES, () => graphError(2, undefined, 500)]]);
    expect((await claimAndSend(c, { maxAttempts: 2 })).body.outcome).toBe("retryable");
    expect((await jobFor(c)).status).toBe("pending");
    await db.prepare("UPDATE dm_jobs SET next_retry_at = NULL").run();
    expect((await claimAndSend(c, { maxAttempts: 2 })).body.outcome).toBe("retryable");
    const job = await jobFor(c);
    expect(job).toMatchObject({ status: "failed", outcome: "retryable", attempt_count: 2 });
    expect(job.error_message).toMatch(/Gave up after 2 attempts/);
    expect(await all("SELECT outcome FROM dm_attempts")).toHaveLength(2);
  });

  it.each([
    [551, 1545041, "skipped", "recipient_unavailable"],
    [100, 2534025, "skipped", "comment_ineligible"],
    [10, 2534022, "skipped", "window_expired"],
    [100, 2534014, "failed", "recipient_not_found"],
    [100, undefined, "failed", "invalid_request"],
  ])("Instagram error %s/%s → %s (%s), not retried", async (code, sub, status, errorCode) => {
    await seed();
    const c = await comment("link");
    mockInstagram([[MESSAGES, () => graphError(code, sub)]]);
    await claimAndSend(c);
    expect(await jobFor(c)).toMatchObject({ status, error_code: errorCode });
    expect(await claimJobs(E, W1, 10)).toHaveLength(0);
  });

  it.each([
    [190, undefined, "token_invalid"],
    [613, 2018338, "abuse_warning"],
    [200, 2534041, "messaging_access_disabled"],
    [10, undefined, "permission_missing"],
  ])("global problem %s/%s stops the engine and keeps the job queued", async (code, sub, stopCode) => {
    await seed();
    const c = await comment("link");
    mockInstagram([[MESSAGES, () => graphError(code, sub)]]);
    const r = await claimAndSend(c);
    expect(r.body.outcome).toBe("blocked");
    expect(r.body.stopEngine?.code).toBe(stopCode);
    expect(await jobFor(c)).toMatchObject({ status: "pending", send_started_at: null, error_code: stopCode });
    if (code === 190) expect((await one("SELECT status FROM instagram_accounts")).status).toBe("expired");
  });

  it("does not call Instagram when not connected, past the window, link unpublished, or over the hourly cap", async () => {
    const { collection } = await seed({ connected: false });
    const calls = mockInstagram([[MESSAGES, () => json({ message_id: "x" })]]);
    const c1 = await comment("link", { from: "1" });
    let r = await claimAndSend(c1);
    expect(r.body).toMatchObject({ outcome: "blocked", stopEngine: { code: "not_connected" } });
    expect((await jobFor(c1)).status).toBe("pending");

    await db.prepare("INSERT INTO instagram_accounts (id, ig_user_id, username, access_token_enc, connected_at, status) VALUES ('acc', ?, 'trendism.in', ?, ?, 'connected')").bind(IG_ID, await encryptSecret(TOKEN, E.TOKEN_ENCRYPTION_KEY, IG_ID), new Date().toISOString()).run();
    const [job] = await claimJobs(E, W1, 1);
    await db.prepare("UPDATE dm_jobs SET received_at = ? WHERE id = ?").bind(new Date(Date.now() - 7 * 86_400_000 + 5 * 60_000).toISOString(), job!.id).run();
    expect((await sendJob(E, BASE, job!.id, W1, undefined)).body.outcome).toBe("ineligible");
    expect((await jobFor(c1)).error_code).toBe("window_expired");

    const c2 = await comment("link", { from: "2" });
    await admin(`/api/v1/collections/${collection.id}`, { method: "PATCH", body: JSON.stringify({ isPublished: false }) });
    await claimAndSend(c2);
    expect(await jobFor(c2)).toMatchObject({ status: "skipped", error_code: "collection_unavailable" });
    await admin(`/api/v1/collections/${collection.id}`, { method: "PATCH", body: JSON.stringify({ isPublished: true }) });

    const c3 = await comment("link", { from: "3" });
    const t = new Date(Date.now() - 60_000).toISOString();
    await db.batch(Array.from({ length: 700 }, (_, i) => db.prepare("INSERT INTO dm_attempts (id, job_id, attempted_at, outcome) VALUES (?, (SELECT id FROM dm_jobs LIMIT 1), ?, 'sent')").bind(`cap-${i}`, t)));
    r = await claimAndSend(c3);
    expect(r.body.outcome).toBe("rate_limited");
    expect(r.body.retryAfterSeconds).toBeGreaterThan(3000);
    expect((await jobFor(c3)).status).toBe("pending");
    expect(calls).toHaveLength(0);
  });

  it("updates the link if the collection's slug changed after the job was queued", async () => {
    const { collection } = await seed();
    const c = await comment("link");
    await admin(`/api/v1/collections/${collection.id}`, { method: "PATCH", body: JSON.stringify({ slug: "winter-fits-2026" }) });
    const calls = mockInstagram([[MESSAGES, () => json({ message_id: "m" })]]);
    await claimAndSend(c);
    expect(calls[0]!.body.message.text).toContain(`${BASE}/c/winter-fits-2026?s=instagram`);
    expect(calls[0]!.body.message.text).not.toContain("/c/winter-fits?");
  });

  it("computes bounded exponential backoff with jitter", () => {
    const p = DEFAULT_POLICY;
    expect(backoffSeconds(1, p, () => 0)).toBe(30);
    expect(backoffSeconds(1, p, () => 1)).toBe(60);
    expect(backoffSeconds(3, p, () => 1)).toBe(240);
    expect(backoffSeconds(20, p, () => 1)).toBe(3600);
  });
});

describe("delivery checks for uncertain jobs", () => {
  async function uncertainJob() {
    await seed();
    const c = await comment("link", { from: "990001", username: "asha" });
    mockInstagram([[MESSAGES, () => { throw new Error("timeout"); }]]);
    await claimAndSend(c);
    vi.restoreAllMocks();
    await db.prepare("UPDATE dm_jobs SET send_started_at = ?, last_attempt_at = ?").bind(new Date(Date.now() - 120_000).toISOString(), new Date(Date.now() - 120_000).toISOString()).run();
    return jobFor(c);
  }
  const conv = (messages: any[], conversations = [{ id: "conv1" }]): Route[] => [
    [/\/me\/conversations\?/, () => json({ data: conversations })],
    [/\/conv1\?fields=messages/, () => json({ messages: { data: messages.map((m) => ({ id: m.id, created_time: Math.floor(Date.now() / 1000) - 60 })) }, id: "conv1" })],
    ...messages.map((m): Route => [new RegExp(`/${m.id}\\?fields=`), () => json({ id: m.id, created_time: new Date(Date.now() - 60_000).toISOString(), from: m.from, message: m.message })]),
  ];

  it("confirms delivery when the reply is in the conversation", async () => {
    const job = await uncertainJob();
    mockInstagram(conv([{ id: "m1", from: { id: IG_ID, username: "trendism.in" }, message: job.message }]));
    const r = await (await post(`/api/v1/queue/jobs/${job.id}/reconcile`)).json<any>();
    expect(r.result).toBe("sent");
    expect(await one("SELECT status, meta_message_id, reconciled_at IS NOT NULL AS rec FROM dm_jobs")).toEqual({ status: "sent", meta_message_id: "m1", rec: 1 });
  });

  it("re-queues when Instagram shows it was not delivered", async () => {
    const job = await uncertainJob();
    mockInstagram(conv([{ id: "m9", from: { id: "990001", username: "asha" }, message: "thanks!" }]));
    expect((await (await post(`/api/v1/queue/jobs/${job.id}/reconcile`)).json<any>()).result).toBe("not_sent");
    expect((await one("SELECT status FROM dm_jobs")).status).toBe("pending");
  });

  it("re-queues when no conversation exists", async () => {
    const job = await uncertainJob();
    mockInstagram([[/\/me\/conversations\?/, () => json({ data: [] })]]);
    expect((await (await post(`/api/v1/queue/jobs/${job.id}/reconcile`)).json<any>()).result).toBe("not_sent");
  });

  it("stays uncertain (and explains) when Instagram can't be asked", async () => {
    const job = await uncertainJob();
    mockInstagram([[/\/me\/conversations\?/, () => graphError(10)]]);
    const r = await (await post(`/api/v1/queue/jobs/${job.id}/reconcile`)).json<any>();
    expect(r.result).toBe("unknown");
    expect((await one("SELECT status, error_message FROM dm_jobs")).error_message).toMatch(/Automatic delivery check failed/);
  });

  it("won't check within a minute of the attempt", async () => {
    const job = await uncertainJob();
    await db.prepare("UPDATE dm_jobs SET send_started_at = ?").bind(new Date().toISOString()).run();
    expect((await post(`/api/v1/queue/jobs/${job.id}/reconcile`)).status).toBe(409);
  });
});

describe("manual actions", () => {
  it("retry/skip/mark-sent follow the rules and are logged", async () => {
    await seed();
    const c = await comment("link");
    mockInstagram([[MESSAGES, () => { throw new Error("timeout"); }]]);
    await claimAndSend(c);
    const job = await jobFor(c);
    expect(job.status).toBe("uncertain");
    expect((await post(`/api/v1/queue/jobs/${job.id}/retry`)).status).toBe(409);
    expect((await post(`/api/v1/queue/jobs/${job.id}/retry`, { confirm: true })).status).toBe(200);
    expect((await jobFor(c)).status).toBe("pending");
    expect((await post(`/api/v1/queue/jobs/${job.id}/skip`)).status).toBe(200);
    expect((await jobFor(c)).status).toBe("skipped");
    expect((await post(`/api/v1/queue/jobs/${job.id}/mark-sent`)).status).toBe(409);
    await db.prepare("UPDATE dm_jobs SET status = 'uncertain'").run();
    expect((await post(`/api/v1/queue/jobs/${job.id}/mark-sent`)).status).toBe(200);
    expect((await jobFor(c)).status).toBe("sent");
    const ops = (await all("SELECT operation FROM app_logs WHERE module = 'queue' AND operation IN ('retry','skip','mark-sent')")).map((r) => r.operation);
    expect(ops.sort()).toEqual(["mark-sent", "retry", "skip"]);
  });

  it("refuses to retry past the 7-day window or touch an in-flight job", async () => {
    await seed();
    const c = await comment("link");
    const [job] = await claimJobs(E, W1, 1);
    expect((await post(`/api/v1/queue/jobs/${job!.id}/skip`)).status).toBe(409);
    await db.prepare("UPDATE dm_jobs SET status = 'failed', received_at = ?").bind(new Date(Date.now() - 8 * 86_400_000).toISOString()).run();
    expect((await post(`/api/v1/queue/jobs/${job!.id}/retry`)).status).toBe(409);
    expect((await jobFor(c)).status).toBe("failed");
  });
});

describe("sync, stats, logs, cron", () => {
  it("sync recovers, ingests and reports, and records the engine heartbeat", async () => {
    await seed();
    await db.prepare("INSERT INTO webhook_events (id, dedupe_key, event_type, payload, signature_ok, process_status, media_id, comment_id, from_id, from_username, comment_text, received_at) VALUES ('e9','comment:late','comments','{}',1,'received',?,'late','777','late_user','link',?)").bind(MEDIA, new Date().toISOString()).run();
    const s = await (await post("/api/v1/queue/sync", { workerId: W1, engineStatus: "running", version: "0.5.0" })).json<any>();
    expect(s.ingested.created).toBe(1);
    expect(s.counts.pending).toBe(1);
    expect(s.dueNow).toBe(1);
    expect(s.account).toMatchObject({ connected: true, username: "trendism.in" });
    expect((await (await admin("/api/v1/queue/engines")).json<any>()).items[0]).toMatchObject({ workerId: W1, status: "running" });
  });

  it("lists jobs with filters and shows attempt history", async () => {
    await seed();
    const c = await comment("link", { username: "findme" });
    await comment("link", { from: "2", username: "other" });
    mockInstagram([[MESSAGES, () => graphError(2, undefined, 500)]]);
    await claimAndSend(c);
    const list = await (await admin("/api/v1/queue/jobs?q=findme")).json<any>();
    expect(list.items).toHaveLength(1);
    const d = await (await admin(`/api/v1/queue/jobs/${list.items[0].id}`)).json<any>();
    expect(d.attempts[0]).toMatchObject({ outcome: "retryable", graphCode: 2, errorCode: "instagram_error" });
    expect((await (await admin("/api/v1/queue/jobs?status=pending")).json<any>()).items).toHaveLength(2);
  });

  it("logs API filters by severity, module, entity and text; engine events are stored as module 'engine'", async () => {
    await seed();
    const c = await comment("link");
    mockInstagram([[MESSAGES, () => graphError(100, 2534014)]]);
    await claimAndSend(c);
    const job = await jobFor(c);
    expect((await post("/api/v1/logs", { level: "warn", operation: "pause", message: "Paused by user", module: "queue" })).status).toBe(201);
    const errors = await (await admin("/api/v1/logs?level=error")).json<any>();
    expect(errors.items.every((i: any) => i.level === "error")).toBe(true);
    expect(errors.items.some((i: any) => i.entityId === job.id)).toBe(true);
    expect((await (await admin(`/api/v1/logs?entity=${job.id}`)).json<any>()).items.length).toBeGreaterThan(0);
    const engine = await (await admin("/api/v1/logs?module=engine")).json<any>();
    expect(engine.items[0]).toMatchObject({ module: "engine", operation: "pause", message: "Paused by user" });
    expect((await (await admin("/api/v1/logs?q=Paused")).json<any>()).items).toHaveLength(1);
    expect(engine.facets.modules).toEqual(expect.arrayContaining(["engine", "queue"]));
  });

  it("the daily cron turns leftover comments into jobs and recovers stale work", async () => {
    await seed();
    await db.prepare("INSERT INTO webhook_events (id, dedupe_key, event_type, payload, signature_ok, process_status, media_id, comment_id, from_id, comment_text, received_at) VALUES ('e7','comment:cron','comments','{}',1,'received',?,'cron','888','LINK',?)").bind(MEDIA, new Date().toISOString()).run();
    await runScheduled({ ...E, PUBLIC_BASE_URL: BASE });
    expect((await jobFor("cron")).status).toBe("pending");
  });

  it("overview counts sent today and uncertain jobs", async () => {
    await seed();
    const a = await comment("link", { from: "1" });
    const b = await comment("link", { from: "2" });
    mockInstagram([[MESSAGES, () => json({ message_id: "m" })]]);
    await claimAndSend(a);
    vi.restoreAllMocks();
    mockInstagram([[MESSAGES, () => { throw new Error("timeout"); }]]);
    await claimAndSend(b);
    const o = await (await admin("/api/v1/overview")).json<any>();
    expect(o).toMatchObject({ sentToday: 1, uncertainMessages: 1, pendingMessages: 0 });
  });
});
