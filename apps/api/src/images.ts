import type { Env } from "./env";

const MAX_BYTES = 5_000_000;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif", "image/gif": "gif" };

function safeImageUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || (u.port && u.port !== "443") || u.username || !h.includes(".")) return null;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || /(^|\.)(localhost|local|internal|lan)$/.test(h)) return null;
    return u;
  } catch { return null; }
}

/** Download the product image into R2. Returns the object key, or null if it cannot be cached (never throws). */
export async function cacheImage(env: Env, productId: string, imageUrl: string): Promise<string | null> {
  const u = safeImageUrl(imageUrl);
  if (!u) return null;
  try {
    const res = await fetch(u.toString(), { redirect: "follow", signal: AbortSignal.timeout(8000), headers: { Accept: "image/*" } });
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const ext = EXT[type];
    if (!res.ok || !ext) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;
    const key = `products/${productId}.${ext}`;
    await env.IMAGES.put(key, buf, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
    return key;
  } catch { return null; }
}

export async function deleteImage(env: Env, key: string | null): Promise<void> {
  if (key) { try { await env.IMAGES.delete(key); } catch { /* best effort */ } }
}

export const IMAGE_TYPES = EXT;

/** Store user-supplied image bytes after validating type and size. Returns key or null. */
export async function storeImage(env: Env, keyBase: string, bytes: ArrayBuffer, type: string): Promise<string | null> {
  const ext = EXT[type.toLowerCase()];
  if (!ext || bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
  const key = `${keyBase}.${ext}`;
  await env.IMAGES.put(key, bytes, { httpMetadata: { contentType: type.toLowerCase(), cacheControl: "public, max-age=31536000, immutable" } });
  return key;
}
