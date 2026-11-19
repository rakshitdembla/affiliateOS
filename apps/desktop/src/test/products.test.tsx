import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionResult, Product } from "@affiliateos/shared";

vi.mock("../lib/api", async (orig) => {
  const real = await orig<typeof import("../lib/api")>();
  return { ...real, api: { ...real.api, listProducts: vi.fn(), extract: vi.fn(), createProduct: vi.fn(), deleteProduct: vi.fn(), updateProduct: vi.fn(), refreshProduct: vi.fn() } };
});
import { api } from "../lib/api";
import { Products } from "../pages/Products";

const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const prod = (o: Partial<Product> = {}): Product => ({
  id: "1", title: "Roadster Jacket", description: null, imageUrl: null, cachedImageUrl: null, priceMinor: 149900, currency: "INR",
  platform: "myntra", affiliateUrl: "https://www.myntra.com/a/1/buy", canonicalUrl: null, extractionStatus: "success", extractionError: null,
  lastExtractedAt: null, priceUpdatedAt: null, isActive: true, createdAt: "", updatedAt: "", ...o,
});
const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><Products /></MemoryRouter></QueryClientProvider>);
const failed: ExtractionResult = { platform: "amazon", status: "failed", fields: { title: null, description: null, imageUrl: null, priceMinor: null, currency: "INR", canonicalUrl: null }, missing: ["title", "image", "price"], error: { code: "extraction_blocked", message: "The website refused automated access (HTTP 403)" }, finalUrl: null };

beforeEach(() => vi.resetAllMocks());

describe("Products page", () => {
  it("shows an honest empty state", async () => {
    m.listProducts.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    wrap();
    expect(await screen.findByText("No products yet")).toBeInTheDocument();
  });

  it("renders products with formatted price and platform", async () => {
    m.listProducts.mockResolvedValue({ items: [prod()], total: 1, limit: 100, offset: 0 });
    wrap();
    expect(await screen.findByText("Roadster Jacket")).toBeInTheDocument();
    expect(screen.getByText("₹1,499")).toBeInTheDocument();
    expect(screen.getByText("Myntra", { selector: "span" })).toBeInTheDocument();
  });

  it("shows an error with retry when the backend fails", async () => {
    m.listProducts.mockRejectedValue(new Error("Could not reach the backend"));
    wrap();
    expect(await screen.findByText("Couldn't load products")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("extraction failure explains why and still allows manual save", async () => {
    m.listProducts.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    m.extract.mockResolvedValue(failed);
    m.createProduct.mockResolvedValue(prod());
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByText("Add product"));
    await user.type(screen.getByLabelText("Affiliate URL"), "https://www.amazon.in/dp/B0ABCDEFGH");
    await user.click(screen.getByText("Fetch details"));
    expect(await screen.findByText(/blocked automated access/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Title"), "Boat Earbuds");
    await user.type(screen.getByLabelText("Price"), "1299");
    await user.click(screen.getByText("Save product"));
    await waitFor(() => expect(m.createProduct).toHaveBeenCalled());
    expect(m.createProduct.mock.calls[0]![0]).toMatchObject({ title: "Boat Earbuds", priceMinor: 129900, extractionStatus: "manual", platform: "amazon" });
  });

  it("validates a bad price before calling the API", async () => {
    m.listProducts.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByText("Add product"));
    await user.click(screen.getByText("Enter details manually instead"));
    await user.type(screen.getByLabelText("Title"), "X");
    await user.type(screen.getByLabelText("Price"), "abc");
    fireEvent.click(screen.getByText("Save product"));
    expect(await screen.findByText(/Price must be a number/)).toBeInTheDocument();
    expect(m.createProduct).not.toHaveBeenCalled();
  });

  it("requires confirmation before deleting", async () => {
    m.listProducts.mockResolvedValue({ items: [prod()], total: 1, limit: 100, offset: 0 });
    m.deleteProduct.mockResolvedValue(null);
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByLabelText("Delete Roadster Jacket"));
    expect(m.deleteProduct).not.toHaveBeenCalled();
    await user.click(screen.getByText("Delete", { selector: "button" }));
    await waitFor(() => expect(m.deleteProduct).toHaveBeenCalledWith("1"));
  });
});
