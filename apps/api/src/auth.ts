import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  // Compare against a fixed-length digest-free loop; length difference folded into result.
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Bearer-token auth for the admin API. Fails closed if no token is configured. */
export const requireAdmin: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const expected = c.env.ADMIN_API_TOKEN;
  if (!expected) {
    return c.json({ error: { code: "auth_not_configured", message: "Server has no ADMIN_API_TOKEN configured" } }, 503);
  }
  const header = c.req.header("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m || !timingSafeEqual(m[1]!, expected)) {
    return c.json({ error: { code: "unauthorized", message: "Missing or invalid credentials" } }, 401);
  }
  await next();
};
