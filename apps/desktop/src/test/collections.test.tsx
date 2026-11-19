import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Collection, CollectionDetail, Product } from "@affiliateos/shared";

vi.mock("../lib/api", async (orig) => {
  const real = await orig<typeof import("../lib/api")>();
  const fns = ["listCollections", "getCollection", "createCollection", "updateCollection", "deleteCollection", "duplicateCollection", "setCollectionProducts", "listProducts", "previewCollection"];
  return { ...real, api: { ...real.api, ...Object.fromEntries(fns.map((f) => [f, vi.fn()])) } };
});
import { api } from "../lib/api";
import { Collections } from "../pages/Collections";

const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const prod = (id: string, title: string): Product => ({ id, title, description: null, imageUrl: null, cachedImageUrl: null, priceMinor: 99900, currency: "INR", platform: "amazon", affiliateUrl: "https://www.amazon.in/dp/B0ABCDEFGH", canonicalUrl: null, extractionStatus: "manual", extractionError: null, lastExtractedAt: null, priceUpdatedAt: null, isActive: true, createdAt: "", updatedAt: "" });
const col = (o: Partial<Collection> = {}): Collection => ({ id: "c1", name: "Winter Fits", slug: "winter-fits", description: null, coverImageUrl: null, previewImageUrl: null, isPublished: false, productCount: 2, publicUrl: "https://x.dev/c/winter-fits", createdAt: "", updatedAt: "", ...o });
const detail = (): CollectionDetail => ({ ...col(), products: [prod("11111111-1111-1111-1111-111111111111", "Alpha"), prod("22222222-2222-2222-2222-222222222222", "Beta")] });
const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><Collections /></MemoryRouter></QueryClientProvider>);

beforeEach(() => { vi.resetAllMocks(); m.listProducts.mockResolvedValue({ items: [prod("33333333-3333-3333-3333-333333333333", "Gamma")], total: 1, limit: 100, offset: 0 }); });

describe("Collections page", () => {
  it("shows an honest empty state", async () => {
    m.listCollections.mockResolvedValue({ items: [] });
    wrap();
    expect(await screen.findByText("No collections yet")).toBeInTheDocument();
  });

  it("renders cards with status and counts; surfaces load errors with retry", async () => {
    m.listCollections.mockResolvedValue({ items: [col({ isPublished: true })] });
    wrap();
    expect(await screen.findByText("Winter Fits")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText(/2 products/)).toBeInTheDocument();
  });
  it("shows an error state when the backend fails", async () => {
    m.listCollections.mockRejectedValue(new Error("Could not reach the backend"));
    wrap();
    expect(await screen.findByText("Couldn't load collections")).toBeInTheDocument();
  });

  it("reorders with the buttons, adds a product, and saves products before publish state", async () => {
    m.listCollections.mockResolvedValue({ items: [col()] });
    m.getCollection.mockResolvedValue(detail());
    m.setCollectionProducts.mockResolvedValue(detail());
    m.updateCollection.mockResolvedValue(detail());
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByLabelText("Edit Winter Fits"));
    await user.click(await screen.findByLabelText("Move Beta up"));
    await user.click(await screen.findByLabelText("Add Gamma"));
    await user.click(screen.getByLabelText(/Published/));
    await user.click(screen.getByText("Save collection"));
    await waitFor(() => expect(m.updateCollection).toHaveBeenCalled());
    expect(m.setCollectionProducts).toHaveBeenCalledWith("c1", ["22222222-2222-2222-2222-222222222222", "11111111-1111-1111-1111-111111111111", "33333333-3333-3333-3333-333333333333"]);
    expect(m.setCollectionProducts.mock.invocationCallOrder[0]).toBeLessThan(m.updateCollection.mock.invocationCallOrder[0]!);
    expect(m.updateCollection.mock.calls[0]![1]).toMatchObject({ isPublished: true });
  });

  it("shows the server's reason when saving fails and keeps the dialog open", async () => {
    m.listCollections.mockResolvedValue({ items: [col()] });
    m.getCollection.mockResolvedValue(detail());
    m.setCollectionProducts.mockResolvedValue(detail());
    m.updateCollection.mockRejectedValue(new Error("That slug is already in use"));
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByLabelText("Edit Winter Fits"));
    await user.click(await screen.findByText("Save collection"));
    expect(await screen.findByRole("alert")).toHaveTextContent("That slug is already in use");
  });

  it("requires confirmation before deleting", async () => {
    m.listCollections.mockResolvedValue({ items: [col()] });
    m.deleteCollection.mockResolvedValue(null);
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByLabelText("Delete Winter Fits"));
    expect(m.deleteCollection).not.toHaveBeenCalled();
    await user.click(screen.getByText("Delete", { selector: "button" }));
    await waitFor(() => expect(m.deleteCollection).toHaveBeenCalledWith("c1"));
  });
});
