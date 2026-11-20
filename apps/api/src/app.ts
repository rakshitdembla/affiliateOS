import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { ActivityItem, HealthResponse, OverviewResponse } from "@affiliateos/shared";
import type { Env } from "./env";
import { requireAdmin } from "./auth";
import { log } from "./logger";
import { products } from "./products";
import { collections } from "./collections";
import { storefront } from "./storefront";
import { igAdmin } from "./instagram/admin";
import { oauthPublic } from "./instagram/oauth";
import { webhooks } from "./instagram/webhooks";
import { compliance } from "./instagram/compliance";
import { queue } from "./queue/routes";
import { automations } from "./automations";
import { logs } from "./logs";
import { analytics } from "./analytics";

export const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
});

/** CORS for the desktop app's origins only. Applies to the admin API and the health check it polls. */
const desktopCors: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const allowed = c.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
  })(c, next);
};
app.use("/api/*", desktopCors);
app.use("/health", desktopCors);

/** Public liveness + dependency check. Contains no business data. */
app.get("/health", async (c) => {
  const checks: HealthResponse["checks"] = { database: { ok: false }, storage: { ok: false } };

  const t0 = Date.now();
  try {
    await c.env.DB.prepare("SELECT 1").first();
    checks.database = { ok: true, latencyMs: Date.now() - t0 };
  } catch {
    checks.database = { ok: false, error: "database_unreachable" };
  }

  const t1 = Date.now();
  try {
    await c.env.IMAGES.list({ limit: 1 });
    checks.storage = { ok: true, latencyMs: Date.now() - t1 };
  } catch {
    checks.storage = { ok: false, error: "storage_unreachable" };
  }

  const ok = checks.database.ok && checks.storage.ok;
  if (!ok) await log(c.env, { level: "error", module: "health", operation: "check", code: "dependency_down", message: JSON.stringify(checks) });
  const body: HealthResponse = {
    status: ok ? "ok" : "degraded",
    service: "affiliateos-api",
    version: c.env.APP_VERSION,
    time: new Date().toISOString(),
    checks,
  };
  return c.json(body, ok ? 200 : 503);
});

const api = new Hono<{ Bindings: Env }>();
api.use("*", requireAdmin);

api.get("/ping", (c) => c.json({ ok: true }));

api.get("/overview", async (c) => {
  const db = c.env.DB;
  const count = async (sql: string): Promise<number> => ((await db.prepare(sql).first<{ n: number }>())?.n ?? 0);
  const [products, collections, published, clicks, pending, failed, sentToday, ig, lastEvent, uncertain] = await Promise.all([
    count("SELECT COUNT(*) n FROM products"),
    count("SELECT COUNT(*) n FROM collections"),
    count("SELECT COUNT(*) n FROM collections WHERE is_published = 1"),
    count("SELECT COUNT(*) n FROM click_events WHERE is_bot = 0"),
    count("SELECT COUNT(*) n FROM dm_jobs WHERE status = 'pending'"),
    count("SELECT COUNT(*) n FROM dm_jobs WHERE status = 'failed'"),
    count("SELECT COUNT(*) n FROM dm_jobs WHERE status = 'sent' AND sent_at >= date('now')"),
    db.prepare("SELECT username FROM instagram_accounts WHERE status = 'connected' LIMIT 1").first<{ username: string | null }>(),
    db.prepare("SELECT MAX(received_at) t FROM webhook_events").first<{ t: string | null }>(),
    count("SELECT COUNT(*) n FROM dm_jobs WHERE status = 'uncertain'"),
  ]);
  const body: OverviewResponse = {
    products, collections, publishedCollections: published, clicks,
    pendingMessages: pending, failedMessages: failed, uncertainMessages: uncertain, sentToday,
    instagram: { connected: !!ig, username: ig?.username ?? null },
    lastEventAt: lastEvent?.t ?? null,
  };
  return c.json(body);
});

api.get("/activity", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, logged_at AS time, level, module, message FROM app_logs ORDER BY logged_at DESC LIMIT 10",
  ).all<ActivityItem>();
  return c.json({ items: results });
});

api.route("/products", products);
api.route("/collections", collections);
api.route("/instagram", igAdmin);
api.route("/automations", automations);
api.route("/queue", queue);
api.route("/logs", logs);
api.route("/analytics", analytics);
app.route("/api/v1", api);

/** Public, immutable product images cached in R2. Keys are unguessable UUIDs. */
app.get("/img/*", async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.slice("/img/".length));
  if (!/^(products\/[0-9a-f-]{36}|collections\/[0-9a-f-]{36}(-\d+)?)\.(jpg|png|webp|avif|gif)$/.test(key)) return c.notFound();
  const obj = await c.env.IMAGES.get(key);
  if (!obj) return c.notFound();
  return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
});

app.route("/", webhooks);
app.route("/", oauthPublic);
app.route("/", compliance);
app.route("/", storefront);

app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found" } }, 404));
app.onError(async (err, c) => {
  await log(c.env, { level: "error", module: "api", operation: `${c.req.method} ${new URL(c.req.url).pathname}`, code: "unhandled", message: err.message });
  return c.json({ error: { code: "internal_error", message: "Internal server error" } }, 500);
});
