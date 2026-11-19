import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstagramStatus } from "@affiliateos/shared";

vi.mock("../lib/open", () => ({ openExternal: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/api", async (orig) => {
  const real = await orig<typeof import("../lib/api")>();
  const fns = ["instagramStatus", "connectInstagram", "checkInstagram", "subscribeInstagram", "refreshInstagramToken", "disconnectInstagram", "instagramMedia", "instagramEvents"];
  return { ...real, api: { ...real.api, ...Object.fromEntries(fns.map((f) => [f, vi.fn()])) } };
});
import { api } from "../lib/api";
import { openExternal } from "../lib/open";
import { Instagram } from "../pages/Instagram";

const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const base = (o: Partial<InstagramStatus> = {}): InstagramStatus => ({
  config: { ready: true, missing: [], graphVersion: "v27.0", metaSecretConfigured: false, redirectUri: "https://x.dev/oauth/instagram/callback", webhookUrl: "https://x.dev/webhooks/instagram", privacyUrl: "https://x.dev/privacy", deauthorizeUrl: "https://x.dev/oauth/instagram/deauthorize", dataDeletionUrl: "https://x.dev/oauth/instagram/data-deletion" },
  account: null, webhooks: { total: 0, last24h: 0, lastReceivedAt: null, lastSignatureKey: null }, ...o,
});
const connected = (): InstagramStatus => base({ account: { igUserId: "1784", username: "trendism.in", accountType: "BUSINESS", profilePictureUrl: null, status: "connected", scopes: ["instagram_business_basic"], tokenExpiresAt: new Date(Date.now() + 45 * 86_400_000).toISOString(), tokenRefreshedAt: new Date().toISOString(), webhooksSubscribed: true, lastCheckedAt: null, lastError: null, connectedAt: new Date().toISOString() } });
const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><Instagram /></MemoryRouter></QueryClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  m.instagramEvents.mockResolvedValue({ items: [] });
  m.instagramMedia.mockResolvedValue({ items: [], after: null });
});

describe("Instagram page", () => {
  it("shows exactly what server configuration is missing and disables Connect", async () => {
    m.instagramStatus.mockResolvedValue(base({ config: { ...base().config, ready: false, missing: ["IG_APP_ID", "IG_APP_SECRET"] } }));
    wrap();
    expect(await screen.findByText("Finish the server setup")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Setup checklist" });
    expect(list).toHaveTextContent("Instagram App ID");
    expect(screen.getAllByLabelText("missing")).toHaveLength(2);
    expect(screen.getAllByLabelText("configured")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Connect Instagram" })).toBeDisabled();
    expect(screen.getByText("https://x.dev/webhooks/instagram")).toBeInTheDocument();
  });

  it("Connect opens the official login in the browser and waits", async () => {
    m.instagramStatus.mockResolvedValue(base());
    m.connectInstagram.mockResolvedValue({ authorizeUrl: "https://www.instagram.com/oauth/authorize?state=s", expiresAt: "" });
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByRole("button", { name: "Connect Instagram" }));
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith("https://www.instagram.com/oauth/authorize?state=s"));
    expect(await screen.findByText(/Finish signing in to Instagram in your browser/)).toBeInTheDocument();
  });

  it("shows a connected account with token lifetime and requires confirmation to disconnect", async () => {
    m.instagramStatus.mockResolvedValue(connected());
    m.disconnectInstagram.mockResolvedValue(base());
    const user = userEvent.setup();
    wrap();
    expect(await screen.findByText("@trendism.in")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText(/\(45 days\)/)).toBeInTheDocument();
    expect(screen.getByText("Subscribed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(m.disconnectInstagram).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", { name: "Disconnect Instagram?" });
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(m.disconnectInstagram).toHaveBeenCalled());
  });

  it("surfaces a failed check (e.g. expired token) with the server's reason", async () => {
    m.instagramStatus.mockResolvedValue(connected());
    m.checkInstagram.mockRejectedValue(new Error("Error validating access token: Session has expired"));
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByRole("button", { name: /Check connection/ }));
    expect(await screen.findByText(/Session has expired/)).toBeInTheDocument();
  });

  it("explains why no webhook events may arrive, and lists events when they do", async () => {
    m.instagramStatus.mockResolvedValue(base());
    wrap();
    expect(await screen.findByText(/No webhook events received yet/)).toHaveTextContent("Live");
  });
  it("lists received comment events", async () => {
    m.instagramStatus.mockResolvedValue(base({ webhooks: { total: 1, last24h: 1, lastReceivedAt: new Date().toISOString(), lastSignatureKey: "instagram" } }));
    m.instagramEvents.mockResolvedValue({ items: [{ id: "1", eventType: "comments", status: "received", error: null, mediaId: "18", commentId: "c1", fromUsername: "shopper", text: "LINK", receivedAt: new Date().toISOString(), deliveryCount: 2, signatureKey: "instagram" }] });
    wrap();
    expect(await screen.findByText("@shopper")).toBeInTheDocument();
    expect(screen.getByText("LINK")).toBeInTheDocument();
    expect(screen.getByText("(delivered 2×)")).toBeInTheDocument();
  });
});
