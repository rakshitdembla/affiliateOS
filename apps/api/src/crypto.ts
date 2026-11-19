const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** Accepts base64url or standard base64 (with or without padding). Throws on invalid input. */
export function b64urlDecode(s: string): Uint8Array {
  const t = s.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export function fromHex(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
export const timingSafeEqualStr = (a: string, b: string): boolean => timingSafeEqualBytes(enc.encode(a), enc.encode(b));

export const randomToken = (bytes = 32): string => b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data)));
}

export async function hmacSha256(secret: string, data: ArrayBuffer | Uint8Array | string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, typeof data === "string" ? enc.encode(data) : data));
}

export function isValidEncryptionKey(keyB64: string | undefined): boolean {
  if (!keyB64) return false;
  try { return b64urlDecode(keyB64).length === 32; } catch { return false; }
}

async function aesKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64urlDecode(keyB64);
  if (raw.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-256-GCM with a random 96-bit IV; `aad` binds the ciphertext to its owner (e.g. the Instagram user id). */
export async function encryptSecret(plain: string, keyB64: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, await aesKey(keyB64), enc.encode(plain));
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(ct))}`;
}

export async function decryptSecret(blob: string, keyB64: string, aad: string): Promise<string> {
  const [v, iv, ct] = blob.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Unsupported ciphertext format");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64urlDecode(iv), additionalData: enc.encode(aad) }, await aesKey(keyB64), b64urlDecode(ct));
  return new TextDecoder().decode(pt);
}

/**
 * Instagram IDs exceed 2^53, so JSON.parse would silently corrupt them. Quote integer literals with 16+ digits
 * that appear outside string literals (never touches text inside strings, e.g. comment text).
 */
export function quoteBigInts(json: string): string {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < json.length) {
    const ch = json[i]!;
    if (inStr) {
      if (ch === "\\") { out += ch + (json[i + 1] ?? ""); i += 2; continue; }
      if (ch === '"') inStr = false;
      out += ch; i++; continue;
    }
    if (ch === '"') { inStr = true; out += ch; i++; continue; }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      let j = i + 1;
      while (j < json.length && /[0-9.eE+-]/.test(json[j]!)) j++;
      const num = json.slice(i, j);
      out += /^-?\d{16,}$/.test(num) ? `"${num}"` : num;
      i = j; continue;
    }
    out += ch; i++;
  }
  return out;
}
