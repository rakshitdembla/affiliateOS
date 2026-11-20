import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API, E2E_TOKEN } from "./env";

const here = dirname(fileURLToPath(import.meta.url));
const conf = JSON.parse(readFileSync(join(here, "../src-tauri/tauri.conf.json"), "utf8"));
/** The exact CSP the Tauri webview enforces. */
export const APP_CSP: string = conf.app.security.csp;

const SHOTS = process.env.E2E_SHOTS ?? join(here, "../test-results/shots");
mkdirSync(SHOTS, { recursive: true });
export const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage });

/** Stand-in for Tauri's IPC: Keychain commands backed by localStorage, opener calls recorded. */
async function installTauriStub(page: Page, token: string | null) {
  await page.addInitScript(({ api, token }) => {
    const KEY = "__e2e_keychain";
    if (localStorage.getItem("__e2e_init") !== "1") {
      localStorage.setItem("__e2e_init", "1");
      localStorage.setItem("affiliateos.apiUrl", api);
      localStorage.setItem(KEY, JSON.stringify(token ? { admin_api_token: token } : {}));
    }
    const read = () => JSON.parse(localStorage.getItem(KEY) ?? "{}");
    (window as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
      transformCallback: (cb: unknown) => { const id = Math.floor(Math.random() * 1e9); (window as any)[`_${id}`] = cb; return id; },
      invoke: async (cmd: string, args: any) => {
        const store = read();
        if (cmd === "secret_get") return store[args.key] ?? null;
        if (cmd === "secret_set") { store[args.key] = args.value; localStorage.setItem(KEY, JSON.stringify(store)); return null; }
        if (cmd === "secret_delete") { delete store[args.key]; localStorage.setItem(KEY, JSON.stringify(store)); return null; }
        if (cmd === "plugin:opener|open_url") { ((window as any).__opened ??= []).push(args.url); return null; }
        if (cmd === "save_export") { ((window as any).__exports ??= []).push(args); return `/Users/e2e/Downloads/${args.fileName}`; }
        throw new Error(`unexpected IPC command ${cmd}`);
      },
    };
  }, { api: API, token });
}

type Fixtures = { app: (opts?: { token?: string | null }) => Promise<Page>; api: APIRequestContext; cspErrors: string[] };

export const test = base.extend<Fixtures>({
  cspErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (m) => { if (/Refused to|Content Security Policy/i.test(m.text())) errors.push(m.text()); });
    await use(errors);
    expect(errors, "CSP violations").toEqual([]);
  },
  app: async ({ page, cspErrors: _ }, use) => {
    // Serve the app documents with the same CSP Tauri applies.
    await page.route("http://localhost:1420/**", async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const res = await route.fetch();
      await route.fulfill({ response: res, headers: { ...res.headers(), "content-security-policy": APP_CSP } });
    });
    await use(async (opts = {}) => {
      await installTauriStub(page, opts.token === undefined ? E2E_TOKEN : opts.token);
      return page;
    });
  },
  api: async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${E2E_TOKEN}` } });
    await use(ctx);
    await ctx.dispose();
  },
});
export { expect };

let n = 0;
export async function seedProduct(api: APIRequestContext, title: string, priceMinor = 129900) {
  const asin = `B0E2E${String(Date.now() % 100000).padStart(5, "0")}`.slice(0, 10).replace(/.$/, String(n++ % 10));
  const res = await api.post("/api/v1/products", { data: { affiliateUrl: `https://www.amazon.in/dp/${asin}?tag=e2e-21&n=${n}`, platform: "amazon", title, priceMinor } });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}
export async function seedPublishedCollection(api: APIRequestContext, name: string, productIds: string[]) {
  const c = await (await api.post("/api/v1/collections", { data: { name, description: "Seeded for end-to-end testing" } })).json();
  expect((await api.put(`/api/v1/collections/${c.id}/products`, { data: { productIds } })).status()).toBe(200);
  const p = await api.patch(`/api/v1/collections/${c.id}`, { data: { isPublished: true } });
  expect(p.status()).toBe(200);
  return p.json();
}
