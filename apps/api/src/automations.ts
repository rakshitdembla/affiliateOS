import { Hono, type Context } from "hono";
import { z } from "zod";
import { MATCH_MODES, MAX_KEYWORD_LENGTH, MAX_KEYWORDS, parseKeywords, validateTemplate, type Automation } from "@affiliateos/shared";
import type { Env } from "./env";
import { log } from "./logger";
import { getAccount } from "./instagram/account";
import { igConfig } from "./instagram/config";
import { collectionLink } from "./queue/ingest";

type Row = Record<string, any>;
const SELECT = `SELECT a.*, c.name AS c_name, c.slug AS c_slug, c.is_published AS c_published,
  (SELECT COUNT(*) FROM dm_jobs j WHERE j.automation_id = a.id) AS s_matched,
  (SELECT COUNT(*) FROM dm_jobs j WHERE j.automation_id = a.id AND j.status = 'sent') AS s_sent,
  (SELECT COUNT(*) FROM dm_jobs j WHERE j.automation_id = a.id AND j.status IN ('pending','processing')) AS s_pending,
  (SELECT COUNT(*) FROM dm_jobs j WHERE j.automation_id = a.id AND j.status = 'failed') AS s_failed
  FROM automations a LEFT JOIN collections c ON c.id = a.collection_id`;

const toAutomation = (r: Row): Automation => ({
  id: r.id, mediaId: r.media_id, reelName: r.reel_name, mediaPermalink: r.media_permalink ?? null, collectionId: r.collection_id,
  collectionName: r.c_name ?? null, collectionSlug: r.c_slug ?? null, collectionPublished: !!r.c_published,
  keywords: (() => { try { return JSON.parse(r.keywords); } catch { return []; } })(), matchMode: r.match_mode, messageTemplate: r.message_template,
  isActive: !!r.is_active, lastRunAt: r.last_run_at ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  stats: { matched: r.s_matched ?? 0, sent: r.s_sent ?? 0, pending: r.s_pending ?? 0, failed: r.s_failed ?? 0 },
});

const schema = z.object({
  mediaId: z.string().trim().regex(/^\d{5,40}$/, "Instagram media IDs are numeric"),
  reelName: z.string().trim().min(1).max(200),
  mediaPermalink: z.string().trim().max(500).refine((u) => /^https:\/\/(www\.)?instagram\.com\//.test(u), "Must be an instagram.com link").nullish(),
  collectionId: z.uuid(),
  keywords: z.array(z.string().max(MAX_KEYWORD_LENGTH)).min(1).max(MAX_KEYWORDS),
  matchMode: z.enum(MATCH_MODES).default("word"),
  messageTemplate: z.string().max(2000),
  isActive: z.boolean().default(false),
});

const bad = (c: Context, code: string, message: string, status: 400 | 404 | 409 = 400, extra: object = {}) => c.json({ error: { code, message }, ...extra }, status);

/** Validate the full configuration; activation additionally requires a published collection and a valid template. */
async function check(env: Env, base: string, d: z.infer<typeof schema>, id: string | null) {
  const keywords = parseKeywords(d.keywords);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!keywords.length) errors.push("Add at least one trigger keyword.");
  const col = await env.DB.prepare("SELECT id, name, slug, is_published FROM collections WHERE id = ?").bind(d.collectionId).first<Row>();
  if (!col) errors.push("The selected collection doesn't exist.");
  const t = validateTemplate(d.messageTemplate, col ? { collectionUrl: collectionLink(base, col.slug), collectionName: col.name } : undefined);
  errors.push(...t.errors);
  warnings.push(...t.warnings);
  if (d.isActive && col && !col.is_published) errors.push("Publish the collection before activating this automation, otherwise people would receive a dead link.");
  if (d.isActive) {
    const others = await env.DB.prepare("SELECT reel_name, keywords FROM automations WHERE media_id = ? AND is_active = 1 AND id != ?").bind(d.mediaId, id ?? "").all<Row>();
    for (const o of others.results) {
      const overlap = keywords.filter((k) => (JSON.parse(o.keywords) as string[]).includes(k));
      if (overlap.length) warnings.push(`"${overlap.join('", "')}" is also a trigger on this post in "${o.reel_name}". The older automation is used.`);
    }
    const account = await getAccount(env);
    if (!account || account.status !== "connected") warnings.push("Instagram isn't connected yet; comments will be queued once it is.");
  }
  return { keywords, errors, warnings };
}

export const automations = new Hono<{ Bindings: Env }>();

automations.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`${SELECT} ORDER BY a.created_at DESC`).all<Row>();
  return c.json({ items: results.map(toAutomation) });
});

automations.get("/:id", async (c) => {
  const r = await c.env.DB.prepare(`${SELECT} WHERE a.id = ?`).bind(c.req.param("id")).first<Row>();
  return r ? c.json(toAutomation(r)) : bad(c, "not_found", "Automation not found", 404);
});

automations.post("/", async (c) => {
  const p = schema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return bad(c, "invalid_request", p.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  const base = igConfig(c.env, c.req.url).base;
  const chk = await check(c.env, base, p.data, null);
  if (chk.errors.length) return bad(c, "invalid_automation", chk.errors.join(" "), 400, { errors: chk.errors, warnings: chk.warnings });
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO automations (id, media_id, reel_name, media_permalink, collection_id, keywords, match_mode, message_template, is_active) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id, p.data.mediaId, p.data.reelName, p.data.mediaPermalink ?? null, p.data.collectionId, JSON.stringify(chk.keywords), p.data.matchMode, p.data.messageTemplate, p.data.isActive ? 1 : 0).run();
  await log(c.env, { level: "info", persist: true, module: "automation", operation: "create", entityId: id, message: `Automation "${p.data.reelName}" created (${p.data.isActive ? "active" : "paused"})` });
  const r = await c.env.DB.prepare(`${SELECT} WHERE a.id = ?`).bind(id).first<Row>();
  return c.json({ ...toAutomation(r!), warnings: chk.warnings }, 201);
});

automations.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const cur = await c.env.DB.prepare("SELECT * FROM automations WHERE id = ?").bind(id).first<Row>();
  if (!cur) return bad(c, "not_found", "Automation not found", 404);
  const patch = schema.partial().safeParse(await c.req.json().catch(() => null));
  if (!patch.success) return bad(c, "invalid_request", patch.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  const merged = schema.parse({
    mediaId: cur.media_id, reelName: cur.reel_name, mediaPermalink: cur.media_permalink, collectionId: cur.collection_id,
    keywords: JSON.parse(cur.keywords), matchMode: cur.match_mode, messageTemplate: cur.message_template, isActive: !!cur.is_active, ...patch.data,
  });
  const chk = await check(c.env, igConfig(c.env, c.req.url).base, merged, id);
  if (chk.errors.length) return bad(c, "invalid_automation", chk.errors.join(" "), 400, { errors: chk.errors, warnings: chk.warnings });
  await c.env.DB.prepare("UPDATE automations SET media_id = ?, reel_name = ?, media_permalink = ?, collection_id = ?, keywords = ?, match_mode = ?, message_template = ?, is_active = ?, updated_at = ? WHERE id = ?")
    .bind(merged.mediaId, merged.reelName, merged.mediaPermalink ?? null, merged.collectionId, JSON.stringify(chk.keywords), merged.matchMode, merged.messageTemplate, merged.isActive ? 1 : 0, new Date().toISOString(), id).run();
  if (patch.data.isActive !== undefined && patch.data.isActive !== !!cur.is_active)
    await log(c.env, { level: "info", persist: true, module: "automation", operation: merged.isActive ? "activate" : "pause", entityId: id, message: `Automation "${merged.reelName}" ${merged.isActive ? "activated" : "paused"}` });
  const r = await c.env.DB.prepare(`${SELECT} WHERE a.id = ?`).bind(id).first<Row>();
  return c.json({ ...toAutomation(r!), warnings: chk.warnings });
});

automations.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const cur = await c.env.DB.prepare("SELECT reel_name FROM automations WHERE id = ?").bind(id).first<Row>();
  if (!cur) return bad(c, "not_found", "Automation not found", 404);
  await c.env.DB.prepare("DELETE FROM automations WHERE id = ?").bind(id).run(); // queued jobs keep their message (automation_id → NULL)
  await log(c.env, { level: "info", persist: true, module: "automation", operation: "delete", entityId: id, message: `Automation "${cur.reel_name}" deleted` });
  return c.body(null, 204);
});
