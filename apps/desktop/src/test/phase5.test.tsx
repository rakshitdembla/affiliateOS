import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Automation, DmJob, QueueStats } from "@affiliateos/shared";

vi.mock("../lib/api", async (orig) => {
  const real = await orig<typeof import("../lib/api")>();
  const fns = ["listAutomations", "createAutomation", "updateAutomation", "deleteAutomation", "listCollections", "instagramStatus", "instagramMedia", "queueJobs", "queueJob", "queueAction", "queueReconcile", "logs", "queueSync", "queueClaim", "queueRelease", "queueSend", "engineLog"];
  return { ...real, getApiUrl: () => "https://aos.example", api: { ...real.api, ...Object.fromEntries(fns.map((f) => [f, vi.fn()])) } };
});
import { api } from "../lib/api";
import { Automations } from "../pages/Automations";
import { Queue } from "../pages/Queue";
import { Logs } from "../pages/Logs";

const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
const col = { id: "c1", name: "Winter Fits", slug: "winter-fits", description: null, coverImageUrl: null, previewImageUrl: null, isPublished: true, productCount: 3, publicUrl: "https://aos.example/c/winter-fits", createdAt: "", updatedAt: "" };
const automation: Automation = { id: "a1", mediaId: "18000000000000123", reelName: "Winter reel", mediaPermalink: null, collectionId: "c1", collectionName: "Winter Fits", collectionSlug: "winter-fits", collectionPublished: true, keywords: ["link"], matchMode: "word", messageTemplate: "Hey [USERNAME]! [COLLECTION_URL]", isActive: true, lastRunAt: null, createdAt: "", updatedAt: "", stats: { matched: 4, sent: 3, pending: 1, failed: 0 } };
const stats: QueueStats = { counts: { pending: 1, processing: 0, sent: 3, failed: 0, skipped: 0, uncertain: 1 }, dueNow: 1, nextRetryAt: null, attemptsLastHour: 4, hourlyCap: 700, account: { connected: true, status: "connected", username: "me" }, ingested: { created: 0, ignored: 0 }, serverTime: "" };
const job = (o: Partial<DmJob> = {}): DmJob => ({ id: "j1", commentId: "c1", mediaId: "m", automationId: "a1", reelName: "Winter reel", collectionId: "c1", collectionName: "Winter Fits", recipientId: "r1", recipientUsername: "asha", commentText: "LINK please", message: "Hey @asha! https://aos.example/c/winter-fits?s=instagram", status: "uncertain", outcome: "uncertain", attemptCount: 1, receivedAt: new Date().toISOString(), processedAt: null, lastAttemptAt: new Date().toISOString(), nextRetryAt: null, sentAt: null, errorCode: "outcome_unknown", errorMessage: "No response from Instagram", claimedBy: null, createdAt: "", updatedAt: "", ...o });

beforeEach(() => {
  vi.clearAllMocks();
  m.listCollections.mockResolvedValue({ items: [col] });
  m.instagramStatus.mockResolvedValue({ account: { status: "connected" }, config: { ready: true } });
  m.instagramMedia.mockResolvedValue({ items: [{ id: "18000000000000999", caption: "New winter reel\nmore", mediaType: "VIDEO", mediaProductType: "REELS", permalink: "https://www.instagram.com/reel/x/", thumbnailUrl: null, timestamp: "2026-11-01T00:00:00+0000" }], after: null });
});

describe("Automations", () => {
  it("lists automations with their stats", async () => {
    m.listAutomations.mockResolvedValue({ items: [automation] });
    wrap(<Automations />);
    const card = await screen.findByRole("article", { name: "Winter reel" });
    expect(card).toHaveTextContent("4 matched · 3 sent · 1 pending · 0 failed");
    expect(within(card).getByText("Active")).toBeInTheDocument();
  });

  it("editor: pick a reel, live preview, keyword tester, and saves normalised keywords", async () => {
    m.listAutomations.mockResolvedValue({ items: [] });
    m.createAutomation.mockResolvedValue({ ...automation, warnings: [] });
    const user = userEvent.setup();
    wrap(<Automations />);
    await user.click(await screen.findByRole("button", { name: "New automation" }));
    await user.click(await screen.findByRole("option", { name: /New winter reel/ }));
    expect(screen.getByLabelText("Media ID")).toHaveValue("18000000000000999");
    expect(screen.getByLabelText("Display name")).toHaveValue("New winter reel");
    await user.selectOptions(screen.getByLabelText("Collection"), "c1");
    await user.clear(screen.getByLabelText("Keywords"));
    await user.type(screen.getByLabelText("Keywords"), "LINK, link , Price");
    expect(screen.getByLabelText("Message preview")).toHaveTextContent("https://aos.example/c/winter-fits?s=instagram");
    await user.clear(screen.getByLabelText("Test a comment"));
    await user.type(screen.getByLabelText("Test a comment"), "what's the price?");
    expect(screen.getByText("Would trigger")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save automation" }));
    await waitFor(() => expect(m.createAutomation).toHaveBeenCalled());
    expect(m.createAutomation.mock.calls[0]![0]).toMatchObject({ mediaId: "18000000000000999", keywords: ["link", "price"], matchMode: "word", collectionId: "c1", isActive: true, mediaPermalink: "https://www.instagram.com/reel/x/" });
  });

  it("editor blocks saving a message without the collection link", async () => {
    m.listAutomations.mockResolvedValue({ items: [] });
    const user = userEvent.setup();
    wrap(<Automations />);
    await user.click(await screen.findByRole("button", { name: "New automation" }));
    await user.clear(screen.getByLabelText("Message template"));
    await user.type(screen.getByLabelText("Message template"), "Thanks!");
    expect(screen.getByText(/must include \[COLLECTION_URL\]/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save automation" })).toBeDisabled();
  });
});

describe("Message Queue", () => {
  it("shows jobs with status counts and an uncertain job's safe actions", async () => {
    m.queueJobs.mockResolvedValue({ items: [job(), job({ id: "j2", status: "sent", outcome: "sent", recipientUsername: "ravi", errorCode: null, errorMessage: null })], stats });
    m.queueJob.mockResolvedValue({ job: job(), attempts: [{ id: "a", attemptedAt: new Date().toISOString(), outcome: "uncertain", httpStatus: null, errorCode: "outcome_unknown", graphCode: null, graphSubcode: null, detail: "No response from Instagram", durationMs: 15000, workerId: "w" }] });
    m.queueAction.mockResolvedValue({ message: "Uncertain job marked as sent manually", job: job({ status: "sent" }) });
    const user = userEvent.setup();
    wrap(<Queue />);
    expect(await screen.findByRole("tab", { name: "Uncertain 1" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sent 3" })).toBeInTheDocument();
    await user.click(screen.getByRole("row", { name: "Reply to asha" }));
    const dialog = await screen.findByRole("dialog", { name: "Reply to @asha" });
    expect(await within(dialog).findByText(/15000 ms/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Check delivery with Instagram" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Retry anyway…" }));
    expect(within(dialog).getByText(/only one private reply per comment/)).toBeInTheDocument();
    expect(m.queueAction).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Mark as sent" }));
    await waitFor(() => expect(m.queueAction).toHaveBeenCalledWith("j1", "mark-sent", undefined));
  });

  it("explains an empty queue", async () => {
    m.queueJobs.mockResolvedValue({ items: [], stats: { ...stats, counts: { pending: 0, processing: 0, sent: 0, failed: 0, skipped: 0, uncertain: 0 } } });
    wrap(<Queue />);
    expect(await screen.findByText(/The queue is empty/)).toBeInTheDocument();
  });
});

describe("Logs", () => {
  it("shows entries and filters by severity and entity", async () => {
    m.logs.mockResolvedValue({ items: [{ id: "l1", time: new Date().toISOString(), level: "error", module: "queue", operation: "send", entityId: "j1-abcdef", code: "recipient_not_found", message: "Not sent to @x: Instagram couldn't find this person." }], facets: { modules: ["queue"], codes: ["recipient_not_found"] } });
    const user = userEvent.setup();
    wrap(<Logs />);
    expect(await screen.findByText(/Instagram couldn't find this person/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "error" }));
    await waitFor(() => expect(m.logs).toHaveBeenLastCalledWith(expect.objectContaining({ level: "error" })));
    await user.click(screen.getByRole("button", { name: "j1-abcde" }));
    await waitFor(() => expect(m.logs).toHaveBeenLastCalledWith(expect.objectContaining({ entity: "j1-abcdef" })));
  });
});
