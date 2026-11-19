import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import { app } from "../src/app";

const call = (path: string, init?: RequestInit) => app.request(path, init, env as any);
const auth = { Authorization: "Bearer test-token" };

describe("health", () => {
  it("reports ok with DB and storage checks", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.storage.ok).toBe(true);
  });
});

describe("auth", () => {
  it("rejects missing token", async () => {
    expect((await call("/api/v1/overview")).status).toBe(401);
  });
  it("rejects wrong token", async () => {
    expect((await call("/api/v1/overview", { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
  });
  it("accepts correct token", async () => {
    expect((await call("/api/v1/ping", { headers: auth })).status).toBe(200);
  });
});

describe("overview", () => {
  it("returns real zeros for an empty database", async () => {
    const body: any = await (await call("/api/v1/overview", { headers: auth })).json();
    expect(body).toMatchObject({ products: 0, collections: 0, pendingMessages: 0, instagram: { connected: false } });
  });
});

describe("cors", () => {
  it("lets the desktop app read /health cross-origin (regression: health card showed Unreachable)", async () => {
    const res = await call("/health", { headers: { Origin: "tauri://localhost" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    const other = await call("/health", { headers: { Origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("allows the Tauri origin and blocks others", async () => {
    const ok = await call("/api/v1/ping", { headers: { ...auth, Origin: "tauri://localhost" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    const bad = await call("/api/v1/ping", { headers: { ...auth, Origin: "https://evil.example" } });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("migrations & constraints", () => {
  it("creates all tables", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf%' AND name NOT LIKE 'sqlite%' AND name != 'd1_migrations'").all<{ name: string }>();
    const names = results.map((r) => r.name);
    for (const t of ["products", "collections", "collection_products", "instagram_accounts", "automations", "webhook_events", "dm_jobs", "dm_attempts", "click_events", "app_logs"]) expect(names).toContain(t);
  });
  it("rejects invalid slug and duplicate comment job", async () => {
    await expect(env.DB.prepare("INSERT INTO collections (id,name,slug) VALUES ('c1','x','Bad Slug')").run()).rejects.toThrow();
    const ins = () => env.DB.prepare("INSERT INTO dm_jobs (id,comment_id,media_id,message,received_at) VALUES (?, 'cm1','m1','hi','2026-01-01T00:00:00Z')").bind(crypto.randomUUID()).run();
    await ins();
    await expect(ins()).rejects.toThrow();
  });
});
