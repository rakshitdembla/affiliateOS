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
