import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, ImageOff, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import type { Product } from "@affiliateos/shared";
import { PLATFORMS } from "@affiliateos/shared";
import { api } from "../lib/api";
import { formatPrice, PLATFORM_LABEL } from "../lib/format";
import { Badge, Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { ConfirmDialog } from "../components/Dialog";
import { ProductDialog } from "../components/ProductDialog";

function Thumb({ p }: { p: Product }) {
  const [broken, setBroken] = useState(false);
  const src = p.cachedImageUrl ?? p.imageUrl;
  return src && !broken ? (
    <img src={src} alt={p.title} loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
  ) : (
    <div className="flex h-full w-full items-center justify-center text-muted" aria-label="No image"><ImageOff size={24} /></div>
  );
}

export function Products() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const list = useQuery({ queryKey: ["products", search, platform, status], queryFn: () => api.listProducts({ search, platform, status, limit: 100 }), retry: false });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["products"] }); qc.invalidateQueries({ queryKey: ["overview"] }); };

  const del = useMutation({
    mutationFn: (p: Product) => api.deleteProduct(p.id),
    onSuccess: () => { setDeleting(null); setNotice({ tone: "ok", text: "Product deleted." }); refresh(); },
    onError: (e) => { setDeleting(null); setNotice({ tone: "bad", text: (e as Error).message }); },
  });
  const reextract = useMutation({
    mutationFn: (p: Product) => api.refreshProduct(p.id),
    onSuccess: ({ extraction }) => {
      setNotice(extraction.error ? { tone: "bad", text: `Refresh failed: ${extraction.error.message}. Existing data was kept.` } : { tone: "ok", text: "Product refreshed." });
      refresh();
    },
    onError: (e) => setNotice({ tone: "bad", text: (e as Error).message }),
  });
  const toggle = useMutation({ mutationFn: (p: Product) => api.updateProduct(p.id, { isActive: !p.isActive }), onSuccess: refresh, onError: (e) => setNotice({ tone: "bad", text: (e as Error).message }) });

  const items = list.data?.items ?? [];
  const filtered = !!(search || platform || status);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-muted">{list.data ? `${list.data.total} product${list.data.total === 1 ? "" : "s"}` : "Paste an affiliate link to add a product."}</p>
        </div>
        <Button onClick={() => setEditing("new")}><Plus size={14} /> Add product</Button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-muted" aria-hidden />
          <input aria-label="Search products" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title…" className="h-9 w-64 rounded-md border border-border bg-surface pl-8 pr-3 text-sm" />
        </div>
        <select aria-label="Filter platform" value={platform} onChange={(e) => setPlatform(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
          <option value="">All platforms</option>{PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
        </select>
        <select aria-label="Filter status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
          <option value="">Active & inactive</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
      </div>

      {notice && <p role="status" className={`mt-4 text-sm ${notice.tone === "ok" ? "text-ok" : "text-bad"}`}>{notice.text}</p>}

      {list.isLoading && <p className="mt-8 text-sm text-muted">Loading products…</p>}
      {list.isError && (
        <Card className="mt-6 border-amber-200 bg-amber-50 text-sm">
          <div className="font-medium">Couldn't load products</div>
          <div className="mt-0.5 text-muted">{(list.error as Error).message}</div>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => list.refetch()}>Retry</Button>
        </Card>
      )}
      {list.isSuccess && items.length === 0 && (
        <Card className="mt-6 text-center text-sm">
          <div className="font-medium">{filtered ? "No products match your filters" : "No products yet"}</div>
          <p className="mt-1 text-muted">{filtered ? "Try clearing the search or filters." : "Click “Add product” and paste an Amazon, Myntra or Meesho affiliate link."}</p>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {items.map((p) => (
          <Card key={p.id} role="article" aria-label={p.title} className={`flex flex-col overflow-hidden p-0 ${p.isActive ? "" : "opacity-60"}`}>
            <div className="aspect-square bg-stone-100"><Thumb p={p} /></div>
            <div className="flex flex-1 flex-col gap-2 p-3">
              <div className="line-clamp-2 text-sm font-medium" title={p.title}>{p.title}</div>
              <div className="text-base font-semibold tabular-nums">{formatPrice(p.priceMinor, p.currency)}</div>
              <div className="flex flex-wrap gap-1">
                <Badge>{PLATFORM_LABEL[p.platform] ?? p.platform}</Badge>
                {!p.isActive && <Badge tone="warn">Inactive</Badge>}
                {p.extractionStatus === "failed" && <Badge tone="bad" >Refresh failed</Badge>}
                {p.extractionStatus === "partial" && <Badge tone="warn">Partial</Badge>}
                {p.extractionStatus === "manual" && <Badge>Manual</Badge>}
              </div>
              <div className="mt-auto flex items-center gap-1 pt-1">
                <Button variant="ghost" size="sm" aria-label={`Edit ${p.title}`} onClick={() => setEditing(p)}><Pencil size={14} /></Button>
                <Button variant="ghost" size="sm" aria-label={`Refresh ${p.title}`} disabled={reextract.isPending} onClick={() => reextract.mutate(p)}><RefreshCw size={14} className={reextract.isPending && reextract.variables?.id === p.id ? "animate-spin" : ""} /></Button>
                <a aria-label={`Open ${p.title}`} href={p.affiliateUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center px-3 text-muted hover:text-ink"><ExternalLink size={14} /></a>
                <Button variant="ghost" size="sm" aria-label={`Delete ${p.title}`} className="ml-auto text-bad" onClick={() => setDeleting(p)}><Trash2 size={14} /></Button>
              </div>
              <button className="text-left text-xs text-muted underline" onClick={() => toggle.mutate(p)} disabled={toggle.isPending}>{p.isActive ? "Deactivate" : "Activate"}</button>
            </div>
          </Card>
        ))}
      </div>

      {editing && <ProductDialog product={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {deleting && <ConfirmDialog title="Delete product?" message={`“${deleting.title}” will be removed permanently, including its cached image.`} busy={del.isPending} onConfirm={() => del.mutate(deleting)} onCancel={() => setDeleting(null)} />}
    </div>
  );
}
