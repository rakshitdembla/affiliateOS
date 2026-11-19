import { Hono, type Context } from "hono";
import { z } from "zod";
import { DM_STATUSES, type DmStatus, type QueueStats } from "@affiliateos/shared";
import type { Env } from "../env";
import { getAccount } from "../instagram/account";
import { igConfig } from "../instagram/config";
import { claimJobs, manualAction, MANUAL_ACTIONS, reconcileJob, recoverStaleJobs, releaseJobs, sendJob } from "./engine";
import { ingestEvents } from "./ingest";
import { JOB_SELECT, getJobRow, toAttempt, toJob, type Row } from "./jobs";
import { HOURLY_CAP } from "./policy";

const workerId = z.uuid();
const bad = (c: Context, code: string, message: string, status: 400 | 404 | 409 = 400) => c.json({ error: { code, message } }, status);
const body = async <T extends z.ZodTypeAny>(c: Context, schema: T) => schema.safeParse(await c.req.json().catch(() => ({})));

export async function queueStats(env: Env, ingested = { created: 0, ignored: 0 }): Promise<QueueStats> {
  const now = new Date().toISOString();
  const [byStatus, due, next, hour, account] = await Promise.all([
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM dm_jobs GROUP BY status").all<{ status: DmStatus; n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM dm_jobs WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ?)").bind(now).first<{ n: number }>(),
    env.DB.prepare("SELECT MIN(next_retry_at) AS t FROM dm_jobs WHERE status = 'pending' AND next_retry_at > ?").bind(now).first<{ t: string | null }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM dm_attempts WHERE attempted_at >= ?").bind(new Date(Date.now() - 3_600_000).toISOString()).first<{ n: number }>(),
    getAccount(env),
  ]);
  const counts = Object.fromEntries(DM_STATUSES.map((s) => [s, 0])) as Record<DmStatus, number>;
  for (const r of byStatus.results) counts[r.status] = r.n;
  return {
    counts, dueNow: due?.n ?? 0, nextRetryAt: next?.t ?? null, attemptsLastHour: hour?.n ?? 0, hourlyCap: HOURLY_CAP,
    account: { connected: !!account && account.status === "connected", status: account?.status ?? null, username: account?.username ?? null },
    ingested, serverTime: now,
  };
}

export const queue = new Hono<{ Bindings: Env }>();

/** Called by the desktop engine on start and every cycle: recover stale work, turn new comments into jobs, report stats. */
queue.post("/sync", async (c) => {
  const p = await body(c, z.object({ workerId: workerId.optional(), engineStatus: z.string().max(40).optional(), detail: z.string().max(300).optional(), version: z.string().max(20).optional() }));
  if (!p.success) return bad(c, "invalid_request", "Invalid sync request");
  await recoverStaleJobs(c.env);
  const ingested = await ingestEvents(c.env, igConfig(c.env, c.req.url).base);
  if (p.data.workerId) {
    await c.env.DB.prepare("INSERT INTO engine_heartbeats (worker_id, status, detail, version, seen_at) VALUES (?,?,?,?,?) ON CONFLICT(worker_id) DO UPDATE SET status = excluded.status, detail = excluded.detail, version = excluded.version, seen_at = excluded.seen_at")
      .bind(p.data.workerId, p.data.engineStatus ?? "unknown", p.data.detail ?? null, p.data.version ?? null, new Date().toISOString()).run();
  }
  return c.json(await queueStats(c.env, ingested));
});

queue.get("/stats", async (c) => c.json(await queueStats(c.env)));

queue.post("/claim", async (c) => {
  const p = await body(c, z.object({ workerId, limit: z.number().int().min(1).max(20).default(5) }));
  if (!p.success) return bad(c, "invalid_request", "workerId (uuid) is required");
  return c.json({ jobs: await claimJobs(c.env, p.data.workerId, p.data.limit) });
});

queue.post("/release", async (c) => {
  const p = await body(c, z.object({ workerId }));
  if (!p.success) return bad(c, "invalid_request", "workerId (uuid) is required");
  return c.json({ released: await releaseJobs(c.env, p.data.workerId) });
});

queue.post("/jobs/:id/send", async (c) => {
  const p = await body(c, z.object({ workerId, policy: z.object({ maxAttempts: z.number(), baseDelaySeconds: z.number(), maxDelaySeconds: z.number() }).partial().optional() }));
  if (!p.success) return bad(c, "invalid_request", "workerId (uuid) is required");
  // Keep going even if the desktop disconnects mid-request, so the outcome is always recorded.
  const work = sendJob(c.env, igConfig(c.env, c.req.url).base, c.req.param("id"), p.data.workerId, p.data.policy);
  try { c.executionCtx.waitUntil(work); } catch { /* no execution context in tests */ }
  const r = await work;
  return c.json(r.body, r.status);
});

queue.get("/jobs", async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.status && (DM_STATUSES as string[]).includes(q.status)) { where.push("j.status = ?"); args.push(q.status); }
  if (q.automationId) { where.push("j.automation_id = ?"); args.push(q.automationId); }
  if (q.q?.trim()) { where.push("(j.recipient_username LIKE ? ESCAPE '\\' OR j.comment_text LIKE ? ESCAPE '\\')"); const like = `%${q.q.trim().replace(/[\\%_]/g, "\\$&")}%`; args.push(like, like); }
  if (q.before) { where.push("j.received_at < ?"); args.push(q.before); }
  const limit = Math.min(Math.max(parseInt(q.limit ?? "50", 10) || 50, 1), 200);
  const { results } = await c.env.DB.prepare(`${JOB_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY j.received_at DESC, j.rowid DESC LIMIT ?`).bind(...args, limit).all<Row>();
  return c.json({ items: results.map(toJob), stats: await queueStats(c.env) });
});

queue.get("/jobs/:id", async (c) => {
  const row = await getJobRow(c.env, c.req.param("id"));
  if (!row) return bad(c, "not_found", "Job not found", 404);
  const { results } = await c.env.DB.prepare("SELECT * FROM dm_attempts WHERE job_id = ? ORDER BY attempted_at").bind(row.id).all<Row>();
  return c.json({ job: toJob(row), attempts: results.map(toAttempt) });
});

queue.post("/jobs/:id/reconcile", async (c) => {
  const r = await reconcileJob(c.env, c.req.param("id"));
  return c.json({ result: r.result, message: r.message, job: r.job }, r.status);
});

for (const action of MANUAL_ACTIONS) {
  queue.post(`/jobs/:id/${action}`, async (c) => {
    const p = await body(c, z.object({ confirm: z.boolean().optional() }));
    const r = await manualAction(c.env, c.req.param("id"), action, { confirm: p.success ? p.data.confirm : false });
    return r.status === 200 ? c.json({ message: r.message, job: r.job }) : c.json({ error: { code: r.status === 404 ? "not_found" : "conflict", message: r.message }, job: r.job }, r.status);
  });
}

queue.get("/engines", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT worker_id, status, detail, version, seen_at FROM engine_heartbeats ORDER BY seen_at DESC LIMIT 10").all<Row>();
  return c.json({ items: results.map((r) => ({ workerId: r.worker_id, status: r.status, detail: r.detail, version: r.version, seenAt: r.seen_at })) });
});
