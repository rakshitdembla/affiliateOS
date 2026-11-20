import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsResponse } from "@affiliateos/shared";

vi.mock("../lib/export", () => ({ saveCsv: vi.fn().mockResolvedValue("/Users/me/Downloads/x.csv") }));
vi.mock("../lib/api", async (orig) => {
  const real = await orig<typeof import("../lib/api")>();
  return { ...real, api: { ...real.api, analytics: vi.fn(), analyticsExport: vi.fn(), listCollections: vi.fn() } };
});
import { api } from "../lib/api";
import { saveCsv } from "../lib/export";
import { Analytics } from "../pages/Analytics";

const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const data: AnalyticsResponse = {
  range: { from: "", to: "", tzOffsetMinutes: 330, collectionId: null },
  totals: { products: 5, collections: 2, publishedCollections: 1, visits: 40, clicks: 12, botVisits: 7, botClicks: 1, comments: 9, messagesQueued: 9, messagesSent: 6, messagesFailed: 2, messagesSkipped: 1, messagesPending: 0, messagesUncertain: 0, successRate: 0.75 },
  daily: [{ day: "2026-11-19", visits: 30, clicks: 8, sent: 4, comments: 6 }, { day: "2026-11-20", visits: 10, clicks: 4, sent: 2, comments: 3 }],
  byPlatform: [{ key: "amazon", label: "Amazon", clicks: 9 }, { key: "myntra", label: "Myntra", clicks: 3 }],
  byCollection: [{ key: "c1", label: "Winter Fits", clicks: 12, visits: 40, ctr: 0.3 }],
  bySource: [{ key: "instagram", label: "instagram", clicks: 10, visits: 30 }],
  topProducts: [{ key: "p1", label: "Wool Coat", clicks: 7 }],
};
const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><Analytics /></MemoryRouter></QueryClientProvider>);

beforeEach(() => { vi.clearAllMocks(); m.analytics.mockResolvedValue(data); m.listCollections.mockResolvedValue({ items: [] }); });

describe("Analytics page", () => {
  it("shows KPIs with bot traffic excluded and the reply success rate", async () => {
    wrap();
    expect(await screen.findByRole("group", { name: "Collection visits" })).toHaveTextContent("40");
    expect(screen.getByRole("group", { name: "Collection visits" })).toHaveTextContent("7 bot/preview visits excluded");
    expect(screen.getByRole("group", { name: "Reply success rate" })).toHaveTextContent("75%");
    expect(screen.getByRole("group", { name: "Clicks per visit" })).toHaveTextContent("0.30");
    expect(within(screen.getByRole("list", { name: "Clicks by platform" })).getByText("Amazon")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Collections performance" })).toHaveTextContent("Winter Fits");
    expect(screen.getByText(/no affiliate network reporting is connected/)).toBeInTheDocument();
  });

  it("chart switches metric and has a table view", async () => {
    const user = userEvent.setup();
    wrap();
    expect(await screen.findByRole("img", { name: "Clicks per day, 12 total" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Visits" }));
    expect(screen.getByRole("img", { name: "Visits per day, 40 total" })).toBeInTheDocument();
    await user.click(screen.getByText("Show table"));
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("changing the range re-queries with the viewer's timezone; export saves the CSV", async () => {
    m.analyticsExport.mockResolvedValue('"date","visits"\r\n');
    const user = userEvent.setup();
    wrap();
    await screen.findByRole("group", { name: "Collection visits" });
    await user.click(screen.getByRole("button", { name: "7 days" }));
    await waitFor(() => expect(m.analytics).toHaveBeenCalledTimes(2));
    const q = m.analytics.mock.calls.at(-1)![0];
    expect(Math.round((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000)).toBeLessThanOrEqual(7);
    expect(q.tz).toBe(String(-new Date().getTimezoneOffset()));
    await user.click(screen.getByRole("button", { name: /Clicks CSV/ }));
    await waitFor(() => expect(saveCsv).toHaveBeenCalled());
    expect((saveCsv as any).mock.calls[0][0]).toMatch(/^affiliateos-clicks-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(await screen.findByText(/Exported to/)).toBeInTheDocument();
  });
});
