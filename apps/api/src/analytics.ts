import { Hono, type Context } from "hono";
import type { AnalyticsResponse, DailyPoint } from "@affiliateos/shared";
import type { Env } from "./env";

type Row = Record<string, any>;
const DAY = 86_400_000;

/** Parse ?from&to (ISO) — default last 30 days — plus a timezone offset for day grouping and an optional collection. */
function parseRange(c: Context) {
  const q = c.req.query();
  const now = Date.now();
  const to = q.to && !Number.isNaN(Date.parse(q.to)) ? new Date(q.to) : new Date(now);
  const from = q.from && !Number.isNaN(Date.parse(q.from)) ? new Date(q.from) : new Date(to.getTime() - 30 * DAY);
  if (from > to) return null;
  if (to.getTime() - from.getTime() > 400 * DAY) return null;
  const tz = Math.max(-840, Math.min(840, parseInt(q.tz ?? "0", 10) || 0));
  const col = q.collectionId && /^[0-9a-f-]{36}$/.test(q.collectionId) ? q.collectionId : null;
  return { from: from.toISOString(), to: to.toISOString(), tz, col };
}
const mod = (tz: number) => `${tz >= 0 ? "+" : "-"}${Math.abs(tz)} minutes`;

export async function buildAnalytics(env: Env, r: NonNullable<ReturnType<typeof parseRange>>): Promise<AnalyticsResponse> {
  const db = env.DB;
  const m = mod(r.tz);
  const colClick = r.col ? "AND collection_id = ?" : "";
  const colArgs = r.col ? [r.col] : [];
  const n = async (sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0;
  const rows = async (sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).all<Row>()).results;
  const jobCol = r.col ? "AND collection_id = ?" : "";

  const [products, collections, published, visits, clicks, botVisits, botClicks, comments, jobsByStatus, sent, failed] = await Promise.all([
    n("SELECT COUNT(*) n FROM products"),
    n("SELECT COUNT(*) n FROM collections"),
    n("SELECT COUNT(*) n FROM collections WHERE is_published = 1"),
    n(`SELECT COUNT(*) n FROM collection_views WHERE is_bot = 0 AND viewed_at >= ? AND viewed_at <= ? ${colClick}`, r.from, r.to, ...colArgs),
    n(`SELECT COUNT(*) n FROM click_events WHERE is_bot = 0 AND clicked_at >= ? AND clicked_at <= ? ${colClick}`, r.from, r.to, ...colArgs),
    n(`SELECT COUNT(*) n FROM collection_views WHERE is_bot = 1 AND viewed_at >= ? AND viewed_at <= ? ${colClick}`, r.from, r.to, ...colArgs),
    n(`SELECT COUNT(*) n FROM click_events WHERE is_bot = 1 AND clicked_at >= ? AND clicked_at <= ? ${colClick}`, r.from, r.to, ...colArgs),
    // With a collection filter, only comments that matched an automation for that collection are attributable to it.
    r.col
      ? n("SELECT COUNT(*) n FROM dm_jobs WHERE collection_id = ? AND received_at >= ? AND received_at <= ?", r.col, r.from, r.to)
      : n("SELECT COUNT(*) n FROM webhook_events WHERE event_type IN ('comments','live_comments') AND received_at >= ? AND received_at <= ?", r.from, r.to),
    rows(`SELECT status, COUNT(*) n FROM dm_jobs WHERE received_at >= ? AND received_at <= ? ${jobCol} GROUP BY status`, r.from, r.to, ...colArgs),
    n(`SELECT COUNT(*) n FROM dm_jobs WHERE status = 'sent' AND sent_at >= ? AND sent_at <= ? ${jobCol}`, r.from, r.to, ...colArgs),
    n(`SELECT COUNT(*) n FROM dm_jobs WHERE status = 'failed' AND updated_at >= ? AND updated_at <= ? ${jobCol}`, r.from, r.to, ...colArgs),
  ]);
  const st = Object.fromEntries(jobsByStatus.map((x) => [x.status, x.n])) as Record<string, number>;

  const [dv, dc, ds, dcm, plat, cols, srcClicks, srcVisits, top] = await Promise.all([
    rows(`SELECT date(viewed_at, ?) d, COUNT(*) n FROM collection_views WHERE is_bot = 0 AND viewed_at >= ? AND viewed_at <= ? ${colClick} GROUP BY d`, m, r.from, r.to, ...colArgs),
    rows(`SELECT date(clicked_at, ?) d, COUNT(*) n FROM click_events WHERE is_bot = 0 AND clicked_at >= ? AND clicked_at <= ? ${colClick} GROUP BY d`, m, r.from, r.to, ...colArgs),
    rows(`SELECT date(sent_at, ?) d, COUNT(*) n FROM dm_jobs WHERE status = 'sent' AND sent_at >= ? AND sent_at <= ? ${jobCol} GROUP BY d`, m, r.from, r.to, ...colArgs),
    r.col
      ? rows("SELECT date(received_at, ?) d, COUNT(*) n FROM dm_jobs WHERE collection_id = ? AND received_at >= ? AND received_at <= ? GROUP BY d", m, r.col, r.from, r.to)
      : rows("SELECT date(received_at, ?) d, COUNT(*) n FROM webhook_events WHERE event_type IN ('comments','live_comments') AND received_at >= ? AND received_at <= ? GROUP BY d", m, r.from, r.to),
    rows(`SELECT COALESCE(platform, 'unknown') k, COUNT(*) n FROM click_events WHERE is_bot = 0 AND clicked_at >= ? AND clicked_at <= ? ${colClick} GROUP BY k ORDER BY n DESC`, r.from, r.to, ...colArgs),
    rows(`SELECT c.id k, c.name label,
            (SELECT COUNT(*) FROM click_events e WHERE e.collection_id = c.id AND e.is_bot = 0 AND e.clicked_at >= ? AND e.clicked_at <= ?) clicks,
            (SELECT COUNT(*) FROM collection_views v WHERE v.collection_id = c.id AND v.is_bot = 0 AND v.viewed_at >= ? AND v.viewed_at <= ?) visits
          FROM collections c ${r.col ? "WHERE c.id = ?" : ""} ORDER BY clicks DESC, visits DESC LIMIT 50`, r.from, r.to, r.from, r.to, ...colArgs),
    rows(`SELECT COALESCE(source, 'direct') k, COUNT(*) n FROM click_events WHERE is_bot = 0 AND clicked_at >= ? AND clicked_at <= ? ${colClick} GROUP BY k`, r.from, r.to, ...colArgs),
    rows(`SELECT COALESCE(source, 'direct') k, COUNT(*) n FROM collection_views WHERE is_bot = 0 AND viewed_at >= ? AND viewed_at <= ? ${colClick} GROUP BY k`, r.from, r.to, ...colArgs),
    rows(`SELECT e.product_id k, COALESCE(p.title, '(deleted product)') label, COUNT(*) n FROM click_events e LEFT JOIN products p ON p.id = e.product_id
          WHERE e.is_bot = 0 AND e.clicked_at >= ? AND e.clicked_at <= ? ${r.col ? "AND e.collection_id = ?" : ""} GROUP BY e.product_id ORDER BY n DESC LIMIT 10`, r.from, r.to, ...colArgs),
  ]);

  // Every day in range (in the viewer's timezone), zero-filled.
  const toDay = (t: number) => new Date(t + r.tz * 60_000).toISOString().slice(0, 10);
  const daily: DailyPoint[] = [];
  const idx = new Map<string, DailyPoint>();
  for (let t = Date.parse(r.from); toDay(t) <= toDay(Date.parse(r.to)); t += DAY) {
    const d = toDay(t);
    if (idx.has(d)) continue;
    const p = { day: d, visits: 0, clicks: 0, sent: 0, comments: 0 };
    idx.set(d, p); daily.push(p);
  }
  const fill = (list: Row[], key: keyof Omit<DailyPoint, "day">) => { for (const x of list) { const p = idx.get(x.d); if (p) p[key] = x.n; } };
  fill(dv, "visits"); fill(dc, "clicks"); fill(ds, "sent"); fill(dcm, "comments");

  const PLATFORM: Record<string, string> = { amazon: "Amazon", myntra: "Myntra", meesho: "Meesho" };
  const sources = new Map<string, { clicks: number; visits: number }>();
  for (const x of srcClicks) sources.set(x.k, { clicks: x.n, visits: 0 });
  for (const x of srcVisits) sources.set(x.k, { clicks: sources.get(x.k)?.clicks ?? 0, visits: x.n });
  const finished = sent + failed;

  return {
    range: { from: r.from, to: r.to, tzOffsetMinutes: r.tz, collectionId: r.col },
    totals: {
      products, collections, publishedCollections: published, visits, clicks, botVisits, botClicks, comments,
      messagesQueued: Object.values(st).reduce((a, b) => a + b, 0), messagesSent: sent, messagesFailed: failed,
      messagesSkipped: st.skipped ?? 0, messagesPending: (st.pending ?? 0) + (st.processing ?? 0), messagesUncertain: st.uncertain ?? 0,
      successRate: finished ? sent / finished : null,
    },
    daily,
    byPlatform: plat.map((x) => ({ key: x.k, label: PLATFORM[x.k] ?? x.k, clicks: x.n })),
    byCollection: cols.filter((x) => x.clicks || x.visits).map((x) => ({ key: x.k, label: x.label, clicks: x.clicks, visits: x.visits, ctr: x.visits ? x.clicks / x.visits : null })),
    bySource: [...sources.entries()].map(([k, v]) => ({ key: k, label: k, ...v })).sort((a, b) => b.clicks + b.visits - (a.clicks + a.visits)),
    topProducts: top.map((x) => ({ key: x.k ?? "deleted", label: x.label, clicks: x.n })),
  };
}

/** CSV cell: quoted, and neutralised against spreadsheet formula injection (=, +, -, @, tab, CR). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export const toCsv = (header: string[], data: unknown[][]) => [header, ...data].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export const analytics = new Hono<{ Bindings: Env }>();

analytics.get("/", async (c) => {
  const r = parseRange(c);
  if (!r) return c.json({ error: { code: "invalid_range", message: "Invalid date range (max 400 days)" } }, 400);
  return c.json(await buildAnalytics(c.env, r));
});

analytics.get("/export", async (c) => {
  const r = parseRange(c);
  if (!r) return c.json({ error: { code: "invalid_range", message: "Invalid date range (max 400 days)" } }, 400);
  const type = c.req.query("type") ?? "daily";
  const colWhere = r.col ? "AND e.collection_id = ?" : "";
  const args = r.col ? [r.col] : [];
  let csv: string;
  if (type === "daily") {
    const a = await buildAnalytics(c.env, r);
    csv = toCsv(["date", "visits", "clicks", "comments", "replies_sent"], a.daily.map((d) => [d.day, d.visits, d.clicks, d.comments, d.sent]));
  } else if (type === "clicks") {
    const { results } = await c.env.DB.prepare(`SELECT e.clicked_at, p.title, e.platform, c.name AS collection, e.source, e.is_bot FROM click_events e
      LEFT JOIN products p ON p.id = e.product_id LEFT JOIN collections c ON c.id = e.collection_id
      WHERE e.clicked_at >= ? AND e.clicked_at <= ? ${colWhere} ORDER BY e.clicked_at LIMIT 100000`).bind(r.from, r.to, ...args).all<Row>();
    csv = toCsv(["time_utc", "product", "platform", "collection", "source", "bot"], results.map((x) => [x.clicked_at, x.title, x.platform, x.collection, x.source ?? "direct", x.is_bot ? "yes" : "no"]));
  } else if (type === "visits") {
    const { results } = await c.env.DB.prepare(`SELECT e.viewed_at, c.name AS collection, e.source, e.is_bot FROM collection_views e LEFT JOIN collections c ON c.id = e.collection_id
      WHERE e.viewed_at >= ? AND e.viewed_at <= ? ${colWhere} ORDER BY e.viewed_at LIMIT 100000`).bind(r.from, r.to, ...args).all<Row>();
    csv = toCsv(["time_utc", "collection", "source", "bot"], results.map((x) => [x.viewed_at, x.collection, x.source ?? "direct", x.is_bot ? "yes" : "no"]));
  } else if (type === "messages") {
    const { results } = await c.env.DB.prepare(`SELECT j.received_at, j.sent_at, j.status, j.outcome, j.error_code, j.attempt_count, j.recipient_username, a.reel_name, c.name AS collection
      FROM dm_jobs j LEFT JOIN automations a ON a.id = j.automation_id LEFT JOIN collections c ON c.id = j.collection_id
      WHERE j.received_at >= ? AND j.received_at <= ? ${r.col ? "AND j.collection_id = ?" : ""} ORDER BY j.received_at LIMIT 100000`).bind(r.from, r.to, ...args).all<Row>();
    csv = toCsv(["received_utc", "sent_utc", "status", "outcome", "error", "attempts", "recipient", "reel", "collection"],
      results.map((x) => [x.received_at, x.sent_at, x.status, x.outcome, x.error_code, x.attempt_count, x.recipient_username, x.reel_name, x.collection]));
  } else {
    return c.json({ error: { code: "invalid_type", message: "type must be daily, clicks, visits or messages" } }, 400);
  }
  return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="affiliateos-${type}-${r.from.slice(0, 10)}-to-${r.to.slice(0, 10)}.csv"` });
});
