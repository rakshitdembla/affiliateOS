import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ExtractionResult, Platform, Product } from "@affiliateos/shared";
import { PLATFORMS } from "@affiliateos/shared";
import { api, ApiError, type ProductInput } from "../lib/api";
import { ERROR_HELP, minorToInput, PLATFORM_LABEL, parsePriceInput } from "../lib/format";
import { Dialog } from "./Dialog";
import { Button } from "./ui/button";

const field = "mt-1 h-9 w-full rounded-md border border-border px-3 text-sm";

/** Add (paste URL → fetch → review → save) or edit a product. Manual entry is always available. */
export function ProductDialog({ product, onClose }: { product?: Product; onClose: () => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState(product?.affiliateUrl ?? "");
  const [platform, setPlatform] = useState<Platform>(product?.platform ?? "amazon");
  const [title, setTitle] = useState(product?.title ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? "");
  const [price, setPrice] = useState(minorToInput(product?.priceMinor ?? null));
  const [canonical, setCanonical] = useState(product?.canonicalUrl ?? null);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [revealed, setRevealed] = useState(!!product);
  const [formError, setFormError] = useState<string | null>(null);

  const done = () => { qc.invalidateQueries({ queryKey: ["products"] }); qc.invalidateQueries({ queryKey: ["overview"] }); onClose(); };

  const fetchDetails = useMutation({
    mutationFn: () => api.extract(url.trim()),
    onSuccess: (r) => {
      setExtraction(r); setRevealed(true); setFormError(null);
      if (r.platform) setPlatform(r.platform);
      if (r.fields.title) setTitle(r.fields.title);
      setDescription(r.fields.description ?? ""); setImageUrl(r.fields.imageUrl ?? "");
      setPrice(minorToInput(r.fields.priceMinor)); setCanonical(r.fields.canonicalUrl);
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const priceMinor = parsePriceInput(price);
      if (priceMinor === "invalid") throw new Error("Price must be a number like 1299 or 1299.50");
      if (!title.trim()) throw new Error("Title is required");
      const base = {
        affiliateUrl: url.trim(), platform, title: title.trim(), description: description.trim() || null,
        imageUrl: imageUrl.trim() || null, priceMinor, canonicalUrl: canonical,
      };
      if (product) return api.updateProduct(product.id, base);
      const status: ProductInput["extractionStatus"] = extraction?.status === "success" ? "success" : extraction?.status === "partial" ? "partial" : "manual";
      return api.createProduct({ ...base, extractionStatus: status, extractionError: extraction?.error?.message ?? null });
    },
    onSuccess: done,
    onError: (e) => setFormError(e instanceof ApiError && e.code === "duplicate" ? "This affiliate URL is already saved." : (e as Error).message),
  });

  const busy = fetchDetails.isPending || save.isPending;
  const fetchErr = fetchDetails.error as Error | null;

  return (
    <Dialog title={product ? "Edit product" : "Add product"} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="text-muted">Affiliate URL</span>
          <div className="flex gap-2">
            <input aria-label="Affiliate URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={field} />
            {!product && <Button onClick={() => fetchDetails.mutate()} disabled={busy || !url.trim()} className="mt-1 shrink-0">{fetchDetails.isPending ? "Fetching…" : "Fetch details"}</Button>}
          </div>
        </label>
        {!revealed && <button className="text-xs text-muted underline" onClick={() => setRevealed(true)}>Enter details manually instead</button>}

        {fetchErr && <p role="alert" className="rounded-md bg-red-50 p-2 text-bad">Couldn't reach the backend: {fetchErr.message}</p>}
        {extraction?.error && (
          <p role="alert" className="rounded-md bg-amber-50 p-2 text-warn">
            <b>{ERROR_HELP[extraction.error.code] ?? "Extraction failed."}</b> {extraction.error.message}. You can fill in the details manually below.
          </p>
        )}
        {extraction && !extraction.error && extraction.missing.length > 0 && (
          <p role="status" className="rounded-md bg-amber-50 p-2 text-warn">Couldn't find: {extraction.missing.join(", ")}. Add it manually or save as is.</p>
        )}
        {extraction?.status === "success" && <p role="status" className="rounded-md bg-green-50 p-2 text-ok">Details extracted. Review and save.</p>}

        {revealed && (
          <>
            <label className="block"><span className="text-muted">Platform</span>
              <select aria-label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} className={field}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
              </select></label>
            <label className="block"><span className="text-muted">Title</span><input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} className={field} maxLength={500} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="text-muted">Price (₹)</span><input aria-label="Price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Leave blank if unknown" className={field} /></label>
              <label className="block"><span className="text-muted">Image URL</span><input aria-label="Image URL" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className={field} /></label>
            </div>
            {imageUrl && <img src={imageUrl} alt="" className="h-24 w-24 rounded-md border border-border object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />}
            <label className="block"><span className="text-muted">Description (optional)</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" /></label>
          </>
        )}
        {formError && <p role="alert" className="text-bad">{formError}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          {revealed && <Button onClick={() => { setFormError(null); save.mutate(); }} disabled={busy}>{save.isPending ? "Saving…" : product ? "Save changes" : "Save product"}</Button>}
        </div>
      </div>
    </Dialog>
  );
}
