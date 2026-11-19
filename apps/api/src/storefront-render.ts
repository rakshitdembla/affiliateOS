import type { CollectionDetail, Product } from "@affiliateos/shared";

export const esc = (s: string | null | undefined): string =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const PLATFORM: Record<string, string> = { amazon: "Amazon", myntra: "Myntra", meesho: "Meesho" };

const price = (p: Product): string =>
  p.priceMinor === null ? "" : new Intl.NumberFormat("en-IN", { style: "currency", currency: p.currency, maximumFractionDigits: p.priceMinor % 100 === 0 ? 0 : 2 }).format(p.priceMinor / 100);

const CSS = `
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:#111;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:0 16px}
header{padding:40px 0 24px;text-align:center}
.cover{width:100%;max-height:320px;object-fit:cover;background:#f2f0ed;display:block;margin:0 0 28px}
h1{font:400 clamp(28px,6vw,46px)/1.15 "Iowan Old Style",Georgia,"Times New Roman",serif;margin:0 0 10px;letter-spacing:-.01em}
.desc{color:#57534e;max-width:560px;margin:0 auto}
.count{margin-top:14px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#78716c}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px 12px;padding:8px 0 40px}
@media(min-width:720px){.grid{grid-template-columns:repeat(3,1fr);gap:32px 20px}}
@media(min-width:960px){.grid{grid-template-columns:repeat(4,1fr)}}
.card{display:flex;flex-direction:column}
.ph{aspect-ratio:4/5;background:#f2f0ed;overflow:hidden;position:relative}
.ph img{width:100%;height:100%;object-fit:cover;display:block}
.ph img.broken{display:none}
.ph .none{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#a8a29e}
.plat{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#78716c;margin:10px 0 2px}
.t{font-size:14px;font-weight:400;margin:0 0 4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pr{font-weight:600;margin-bottom:10px;min-height:1.5em}
.btn{margin-top:auto;display:block;text-align:center;background:#111;color:#fff;text-decoration:none;padding:11px 8px;font-size:13px;letter-spacing:.06em;text-transform:uppercase}
.btn:hover,.btn:focus-visible{background:#44403c}
.empty{text-align:center;color:#78716c;padding:60px 0}
footer{border-top:1px solid #e7e5e4;padding:20px 0 40px;font-size:12px;color:#78716c;text-align:center}
.banner{background:#111;color:#fff;text-align:center;font-size:12px;padding:6px}
`;

const BROKEN_IMG_JS = `document.addEventListener("error",function(e){var t=e.target;if(t&&t.tagName==="IMG")t.classList.add("broken")},true);`;

export function renderCollectionPage(
  c: CollectionDetail,
  products: Product[],
  opts: { nonce: string; preview?: boolean; source?: string | null },
): string {
  const origin = new URL(c.publicUrl).origin;
  const cover = c.coverImageUrl;
  const og = cover ?? c.previewImageUrl;
  const desc = c.description || `${products.length} hand-picked finds`;
  const src = opts.source ? `&s=${encodeURIComponent(opts.source)}` : "";
  const cards = products.map((p) => {
    const img = p.cachedImageUrl ?? p.imageUrl;
    return `<article class="card">
  <div class="ph"><span class="none" aria-hidden="true">Image unavailable</span>${img ? `<img src="${esc(img)}" alt="${esc(p.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" style="position:relative">` : ""}</div>
  <div class="plat">${esc(PLATFORM[p.platform] ?? p.platform)}</div>
  <h2 class="t">${esc(p.title)}</h2>
  <div class="pr">${esc(price(p))}</div>
  <a class="btn" href="${origin}/go/${p.id}?c=${c.id}${src}" rel="sponsored nofollow noopener" target="_blank">Shop now</a>
</article>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.name)}</title>
<meta name="description" content="${esc(desc)}">
${opts.preview ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(c.publicUrl)}">`}
<meta property="og:type" content="website"><meta property="og:title" content="${esc(c.name)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(c.publicUrl)}">
${og ? `<meta property="og:image" content="${esc(og)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(og)}">` : '<meta name="twitter:card" content="summary">'}
<style>${CSS}</style>
</head><body>
${opts.preview ? '<div class="banner">Preview — not tracked</div>' : ""}
${cover ? `<img class="cover" src="${esc(cover)}" alt="" decoding="async">` : ""}
<div class="wrap">
<header><h1>${esc(c.name)}</h1>${c.description ? `<p class="desc">${esc(c.description)}</p>` : ""}<div class="count">${products.length} ${products.length === 1 ? "item" : "items"}</div></header>
${products.length ? `<main class="grid">${cards}</main>` : '<p class="empty">No products are available right now.</p>'}
<footer>As an affiliate, we may earn a commission on purchases made through these links, at no extra cost to you. Prices may change.</footer>
</div>
${opts.preview ? "" : `<script nonce="${opts.nonce}">${BROKEN_IMG_JS}</script>`}
</body></html>`;
}

export function renderMessagePage(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap"><header style="padding-top:20vh"><h1>${esc(title)}</h1><p class="desc">${esc(message)}</p></header></div></body></html>`;
}
