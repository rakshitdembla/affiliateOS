// Minimal stand-in for Instagram's API, used only by the local E2E Worker (IG_GRAPH_BASE=http://localhost:8799).
// Records private replies so tests can assert exactly what would have been sent. Never contacts Meta.
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_META_PORT ?? 8799);
const IG_ID = "17841400000000077";
let sends = [];

const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const body = await readBody(req);
  if (path === "/__health") return json(res, 200, { ok: true });
  if (path === "/__sends") return json(res, 200, sends);
  if (path === "/__reset") { sends = []; return json(res, 200, { ok: true }); }
  if (req.method === "POST" && path === "/oauth/access_token") {
    const f = new URLSearchParams(body);
    if (f.get("code") !== "e2e-code") return json(res, 400, { error_type: "OAuthException", code: 400, error_message: "Matching code was not found or was already used" });
    return json(res, 200, `{"data":[{"access_token":"IGAAe2e_short_token_abcdefghijklmnopqrstuvwxyz","user_id":${IG_ID},"permissions":"instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages"}]}`);
  }
  if (path === "/access_token") return json(res, 200, { access_token: "IGAAe2e_long_token_abcdefghijklmnopqrstuvwxyz012", token_type: "bearer", expires_in: 5183944 });
  if (path === "/refresh_access_token") return json(res, 200, { access_token: "IGAAe2e_long_token_abcdefghijklmnopqrstuvwxyz012", token_type: "bearer", expires_in: 5183944 });
  if (path === "/v27.0/me") return json(res, 200, `{"id":"9901","user_id":${IG_ID},"username":"e2e.creator","account_type":"BUSINESS","profile_picture_url":null}`);
  if (path === "/v27.0/me/subscribed_apps") return req.method === "GET" ? json(res, 200, { data: [{ subscribed_fields: ["comments"] }] }) : json(res, 200, { success: true });
  if (path === "/v27.0/me/media") return json(res, 200, { data: [{ id: "18000000000000555", caption: "E2E winter reel\nwith more text", media_type: "VIDEO", media_product_type: "REELS", permalink: "https://www.instagram.com/reel/e2e/", timestamp: "2026-11-01T10:00:00+0000" }] });
  if (req.method === "POST" && path === `/v27.0/${IG_ID}/messages`) {
    const b = JSON.parse(body || "{}");
    const commentId = b?.recipient?.comment_id ?? "";
    sends.push({ commentId, text: b?.message?.text ?? null, auth: req.headers.authorization ?? null });
    if (commentId.includes("fail")) return json(res, 400, { error: { message: "No matching Instagram user", type: "OAuthException", code: 100, error_subcode: 2534014, fbtrace_id: "e2e" } });
    return json(res, 200, { recipient_id: "990001", message_id: `mid.e2e.${sends.length}` });
  }
  json(res, 404, { error: { message: `mock: unknown route ${req.method} ${path}`, code: 100 } });
}).listen(PORT, "127.0.0.1", () => console.log(`mock Instagram API on http://localhost:${PORT}`));
