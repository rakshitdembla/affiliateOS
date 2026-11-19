import { Hono } from "hono";
import { z } from "zod";
import type { LogItem } from "@affiliateos/shared";
import type { Env } from "./env";
import { log } from "./logger";

export const logs = new Hono<{ Bindings: Env }>();

/** Filter by date range, severity, module, error code, entity/job id and text. Cursor: `before` (logged_at). */
logs.get("/", async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const args: unknown[] = [];
  const levels = (q.level ?? "").split(",").filter((l) => ["debug", "info", "warn", "error"].includes(l));
  if (levels.length) { where.push(`level IN (${levels.map(() => "?").join(",")})`); args.push(...levels); }
  if (q.module) { where.push("module = ?"); args.push(q.module); }
  if (q.code) { where.push("code = ?"); args.push(q.code); }
  if (q.entity) { where.push("entity_id = ?"); args.push(q.entity); }
  if (q.from) { where.push("logged_at >= ?"); args.push(q.from); }
  if (q.to) { where.push("logged_at <= ?"); args.push(q.to); }
  if (q.before) { where.push("logged_at < ?"); args.push(q.before); }
  if (q.q?.trim()) { where.push("message LIKE ? ESCAPE '\\'"); args.push(`%${q.q.trim().replace(/[\\%_]/g, "\\$&")}%`); }
  const limit = Math.min(Math.max(parseInt(q.limit ?? "100", 10) || 100, 1), 500);
  const { results } = await c.env.DB.prepare(
    `SELECT id, logged_at, level, module, operation, entity_id, code, message FROM app_logs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY logged_at DESC, rowid DESC LIMIT ?`,
  ).bind(...args, limit).all<Record<string, any>>();
  const items: LogItem[] = results.map((r) => ({ id: r.id, time: r.logged_at, level: r.level, module: r.module, operation: r.operation, entityId: r.entity_id, code: r.code, message: r.message }));
  const [modules, codes] = await Promise.all([
    c.env.DB.prepare("SELECT DISTINCT module FROM app_logs ORDER BY module").all<{ module: string }>(),
    c.env.DB.prepare("SELECT DISTINCT code FROM app_logs WHERE code IS NOT NULL ORDER BY code").all<{ code: string }>(),
  ]);
  return c.json({ items, facets: { modules: modules.results.map((m) => m.module), codes: codes.results.map((x) => x.code) } });
});

/** The desktop engine records its own events (pause/resume, offline, stops) here so they appear with server events. */
logs.post("/", async (c) => {
  const p = z.object({
    level: z.enum(["info", "warn", "error"]),
    operation: z.string().max(60),
    message: z.string().min(1).max(1000),
    code: z.string().max(60).optional(),
    entityId: z.string().max(100).optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: { code: "invalid_request", message: "Invalid log entry" } }, 400);
  await log(c.env, { ...p.data, module: "engine", persist: true });
  return c.json({ ok: true }, 201);
});
