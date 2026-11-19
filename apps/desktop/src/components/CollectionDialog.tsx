import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GripVertical, ImagePlus, Trash2, X } from "lucide-react";
import type { CollectionDetail, Product } from "@affiliateos/shared";
import { api } from "../lib/api";
import { formatPrice } from "../lib/format";
import { Dialog } from "./Dialog";
import { Button } from "./ui/button";

const field = "mt-1 h-9 w-full rounded-md border border-border px-3 text-sm";

export function CollectionDialog({ collection, onClose }: { collection?: CollectionDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(collection?.name ?? "");
  const [slug, setSlug] = useState(collection?.slug ?? "");
  const [description, setDescription] = useState(collection?.description ?? "");
  const [published, setPublished] = useState(collection?.isPublished ?? false);
  const [items, setItems] = useState<Product[]>(collection?.products ?? []);
  const [cover, setCover] = useState<string | null>(collection?.coverImageUrl ?? null);
  const [search, setSearch] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const all = useQuery({ queryKey: ["products", "picker"], queryFn: () => api.listProducts({ limit: 100 }) });
  const inIds = new Set(items.map((p) => p.id));
  const available = (all.data?.items ?? []).filter((p) => !inIds.has(p.id) && p.title.toLowerCase().includes(search.toLowerCase()));

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items]; const [m] = next.splice(from, 1); next.splice(to, 0, m!); setItems(next);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name is required");
      let id = collection?.id;
      if (!id) id = (await api.createCollection({ name: name.trim(), slug: slug.trim() || undefined, description: description.trim() || null })).id;
      // Products first so publishing sees them; then details + publish state.
      await api.setCollectionProducts(id, items.map((p) => p.id));
      return api.updateCollection(id, { name: name.trim(), ...(slug.trim() ? { slug: slug.trim() } : {}), description: description.trim() || null, isPublished: published });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["collections"] }); qc.invalidateQueries({ queryKey: ["overview"] }); onClose(); },
    onError: (e) => setError((e as Error).message),
  });

  const upload = useMutation({
    mutationFn: (f: File) => { if (!collection) throw new Error("Save the collection first, then add a cover"); return api.uploadCover(collection.id, f); },
    onSuccess: (d) => { setCover(d.coverImageUrl); qc.invalidateQueries({ queryKey: ["collections"] }); },
    onError: (e) => setError((e as Error).message),
  });
  const removeCover = useMutation({
    mutationFn: () => api.deleteCover(collection!.id),
    onSuccess: () => { setCover(null); qc.invalidateQueries({ queryKey: ["collections"] }); },
    onError: (e) => setError((e as Error).message),
  });

  const copy = async () => { if (collection) { await navigator.clipboard.writeText(collection.publicUrl).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 1500); } };

  return (
    <Dialog title={collection ? "Edit collection" : "New collection"} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <label className="block"><span className="text-muted">Name</span><input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={field} /></label>
        <label className="block"><span className="text-muted">URL slug {collection ? "" : "(optional — generated from the name)"}</span>
          <input aria-label="Slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="winter-outfits" className={field} /></label>
        <label className="block"><span className="text-muted">Description</span><textarea aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" /></label>

        <div className="flex items-center gap-3">
          {cover ? <img src={cover} alt="Cover" className="h-14 w-24 rounded-md border border-border object-cover" /> : <div className="flex h-14 w-24 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted">No cover</div>}
          <label className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-stone-50 ${!collection ? "pointer-events-none opacity-50" : ""}`}>
            <ImagePlus size={14} /> {upload.isPending ? "Uploading…" : "Upload cover"}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" disabled={!collection || upload.isPending} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
          </label>
          {cover && <Button variant="ghost" size="sm" onClick={() => removeCover.mutate()} disabled={removeCover.isPending}>Remove</Button>}
          {!collection && <span className="text-xs text-muted">Available after the first save.</span>}
        </div>

        <label className="flex items-center gap-2"><input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} /> Published (visible at its public link)</label>
        {collection && published && collection.isPublished && (
          <div className="flex items-center gap-2 text-xs text-muted"><span className="truncate">{collection.publicUrl}</span><Button variant="outline" size="sm" onClick={copy}>{copied ? "Copied" : "Copy link"}</Button></div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 font-medium">In this collection ({items.length})</div>
            {items.length === 0 && <p className="rounded-md border border-dashed border-border p-3 text-muted">No products yet. Add some from the list.</p>}
            <ul className="space-y-1" aria-label="Collection products">
              {items.map((p, i) => (
                <li key={p.id} draggable onDragStart={() => setDragFrom(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragFrom !== null) move(dragFrom, i); setDragFrom(null); }}
                  className="flex items-center gap-2 rounded-md border border-border bg-surface p-1.5">
                  <GripVertical size={14} className="shrink-0 cursor-grab text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{p.title}{!p.isActive && <span className="ml-1 text-warn">(inactive)</span>}</span>
                  <Button variant="ghost" size="sm" aria-label={`Move ${p.title} up`} disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp size={13} /></Button>
                  <Button variant="ghost" size="sm" aria-label={`Move ${p.title} down`} disabled={i === items.length - 1} onClick={() => move(i, i + 1)}><ArrowDown size={13} /></Button>
                  <Button variant="ghost" size="sm" aria-label={`Remove ${p.title}`} onClick={() => setItems(items.filter((x) => x.id !== p.id))}><X size={13} /></Button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 font-medium">Add products</div>
            <input aria-label="Search products to add" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="mb-2 h-8 w-full rounded-md border border-border px-3 text-sm" />
            {all.isLoading && <p className="text-muted">Loading…</p>}
            {all.isError && <p className="text-bad">Couldn't load products.</p>}
            {all.isSuccess && available.length === 0 && <p className="text-muted">{all.data.items.length === 0 ? "No products exist yet — add some on the Products page." : "Nothing to add."}</p>}
            <ul className="max-h-56 space-y-1 overflow-y-auto" aria-label="Available products">
              {available.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-md border border-border p-1.5">
                  <span className="min-w-0 flex-1 truncate">{p.title}</span><span className="text-xs text-muted">{formatPrice(p.priceMinor, p.currency)}</span>
                  <Button variant="outline" size="sm" aria-label={`Add ${p.title}`} onClick={() => setItems([...items, p])}>Add</Button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {error && <p role="alert" className="text-bad">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => { setError(null); save.mutate(); }} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save collection"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
