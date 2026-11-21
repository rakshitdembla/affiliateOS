import { Hono, type Context } from "hono";
import type { CollectionDetail } from "@affiliateos/shared";
import type { Env } from "./env";
import { collectionFromRow, loadProducts } from "./collections";
import { log } from "./logger";
import { renderCollectionPage, renderMessagePage } from "./storefront-render";

export const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|headless|curl|wget|python-requests|go-http|monitor/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SOURCE = /^[a-z0-9_-]{1,32}$/i;

const isBot = (ua: string | undefined) => !ua || BOT_RE.test(ua);
const cleanSource = (s: string | undefined) => (s && SOURCE.test(s) ? s.toLowerCase() : null);

/**
 * Per-IP cap on analytics writes from public pages. Visitors are always served; over the limit we just stop
 * recording, so bots can't inflate analytics or burn the database write quota.
 */
async function canRecord(c: Context<{ Bindings: Env }>, kind: "view" | "click"): Promise<boolean> {
  if (!c.env.PUBLIC_RL) return true;
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  try { return (await c.env.PUBLIC_RL.limit({ key: `${kind}:${ip}` })).success; } catch { return true; }
}

/** Run a write after responding when an execution context exists; otherwise await it (tests). */
async function defer(c: Context<{ Bindings: Env }>, p: Promise<unknown>): Promise<void> {
  const safe = p.catch(() => undefined);
  try { c.executionCtx.waitUntil(safe); } catch { await safe; }
}

const html = (c: Context<{ Bindings: Env }>, body: string, status: 200 | 404 | 410 = 200, nonce?: string, cache = "no-store") =>
  c.html(body, status, {
    "Cache-Control": cache,
    "Content-Security-Policy": `default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src ${nonce ? `'nonce-${nonce}'` : "'none'"}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });

export const storefront = new Hono<{ Bindings: Env }>();

/** Public home page (what reviewers and visitors see at the app's website). */
storefront.get("/", (c) => c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AffiliateOS</title><meta name="description" content="Shoppable outfit collections from @trendism.in, with links sent on request.">
<style>body{margin:0;background:#fff;color:#1c1917;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}main{max-width:720px;margin:0 auto;padding:56px 20px}h1{font:400 44px/1.15 Georgia,serif;margin:0 0 12px}h2{font-size:18px;margin-top:32px}a{color:#1c1917}.muted{color:#78716c}</style></head><body><main>
<h1>AffiliateOS</h1><p class="muted">The shopping-link service behind the Instagram creator @trendism.in.</p>
<h2>What it does</h2><p>The creator posts outfit reels. When you comment the keyword shown in the reel (for example “LINK”), you get <b>one private reply</b> on Instagram with a link to a collection page listing the products from that reel, at retailers such as Amazon, Myntra and Meesho.</p>
<h2>How messages work</h2><ul><li>Replies are sent only when you comment the keyword, through Instagram's official private-reply feature.</li><li>One reply per comment, at most one per person per reel, and only within 7 days of the comment.</li><li>No marketing messages, no follow-ups, no sharing or selling of your data.</li></ul>
<h2>Affiliate disclosure</h2><p>Collection pages contain affiliate links; the creator may earn a commission on purchases at no extra cost to you.</p>
<p class="muted" style="margin-top:48px"><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a> · <a href="/data-deletion">Data deletion</a></p>
</main></body></html>`, 200, { "Cache-Control": "public, max-age=3600", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" }));
storefront.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /go/\nDisallow: /api/\nAllow: /c/\n", 200, { "Cache-Control": "public, max-age=3600" }));

storefront.get("/c/:slug", async (c) => {
  const slug = c.req.param("slug").toLowerCase();
  const row = /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)
    ? await c.env.DB.prepare("SELECT c.*, (SELECT COUNT(*) FROM collection_products cp WHERE cp.collection_id = c.id) AS product_count, (SELECT COALESCE(p.cached_image_key,p.image_url) FROM collection_products cp JOIN products p ON p.id=cp.product_id WHERE cp.collection_id=c.id AND COALESCE(p.cached_image_key,p.image_url) IS NOT NULL ORDER BY cp.position LIMIT 1) AS first_image FROM collections c WHERE c.slug = ? AND c.is_published = 1").bind(slug).first<Record<string, any>>()
    : null;
  if (!row) return html(c, renderMessagePage("Collection not found", "This collection doesn't exist or is no longer available."), 404);

  const origin = new URL(c.req.url).origin;
  const products = await loadProducts(c.env, row.id, origin, true);
  const detail: CollectionDetail = { ...collectionFromRow(row, origin), products };
  const source = cleanSource(c.req.query("s"));
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));

  if (await canRecord(c, "view")) await defer(c, c.env.DB.prepare("INSERT INTO collection_views (id, collection_id, source, is_bot) VALUES (?,?,?,?)")
    .bind(crypto.randomUUID(), row.id, source, isBot(c.req.header("User-Agent")) ? 1 : 0).run());
  return html(c, renderCollectionPage(detail, products, { nonce, source }), 200, nonce, "public, max-age=60");
});

/** Redirect to the stored affiliate URL (never a user-supplied destination) and record the click. */
storefront.get("/go/:id", async (c) => {
  const id = c.req.param("id");
  const notFound = () => html(c, renderMessagePage("Product unavailable", "This item is no longer available."), 404);
  if (!UUID.test(id)) return notFound();
  const p = await c.env.DB.prepare("SELECT id, platform, affiliate_url FROM products WHERE id = ? AND is_active = 1").bind(id).first<{ id: string; platform: string; affiliate_url: string }>();
  if (!p) return notFound();

  let collectionId: string | null = null;
  const cq = c.req.query("c");
  if (cq && UUID.test(cq)) {
    const link = await c.env.DB.prepare("SELECT 1 x FROM collection_products WHERE collection_id = ? AND product_id = ?").bind(cq, id).first();
    if (link) collectionId = cq;
  }
  if (await canRecord(c, "click")) await defer(c, c.env.DB.prepare("INSERT INTO click_events (id, product_id, collection_id, platform, source, is_bot) VALUES (?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), p.id, collectionId, p.platform, cleanSource(c.req.query("s")), isBot(c.req.header("User-Agent")) ? 1 : 0).run()
    .catch((e) => log(c.env, { level: "error", module: "redirect", operation: "record_click", entityId: id, code: "click_write_failed", message: String(e?.message ?? e) })));

  return new Response(null, { status: 302, headers: { Location: p.affiliate_url, "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer-when-downgrade" } });
});
