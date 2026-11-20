import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Overview } from "../pages/Overview";

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
);
afterEach(() => vi.restoreAllMocks());

describe("Overview", () => {
  it("prompts for setup (no fake data) when no token is configured", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(wrap(<Overview />));
    await waitFor(() => expect(screen.getByText("Backend access not configured")).toBeInTheDocument());
    expect(screen.getByText("Unreachable")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("Overview needs-attention banner", () => {
  it("lists checks that aren't OK", async () => {
    const { api } = await import("../lib/api");
    vi.spyOn(api, "health").mockResolvedValue({ status: "ok", service: "affiliateos-api", version: "x", time: "", checks: { database: { ok: true }, storage: { ok: true } } });
    vi.spyOn(api, "overview").mockResolvedValue({ products: 1, collections: 1, publishedCollections: 1, clicks: 0, pendingMessages: 2, failedMessages: 0, uncertainMessages: 0, sentToday: 0, instagram: { connected: true, username: "me" }, lastEventAt: null });
    vi.spyOn(api, "activity").mockResolvedValue({ items: [] });
    vi.spyOn(api, "systemStatus").mockResolvedValue({ overall: "warn", time: "", checks: [
      { id: "database", label: "Database (D1)", status: "ok", detail: "Reachable" },
      { id: "engine", label: "Mac queue engine", status: "warn", detail: "Not seen for 3 h while 2 replies wait" },
    ] });
    render(wrap(<Overview />));
    const banner = await screen.findByRole("region", { name: "Needs attention" });
    expect(banner).toHaveTextContent("Mac queue engine: Not seen for 3 h while 2 replies wait");
    expect(banner).not.toHaveTextContent("Database");
  });
});
