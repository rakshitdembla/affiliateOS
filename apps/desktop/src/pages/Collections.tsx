import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, ExternalLink, ImageOff, Link as LinkIcon, Pencil, Plus, Trash2 } from "lucide-react";
import type { Collection, CollectionDetail } from "@affiliateos/shared";
import { api } from "../lib/api";
import { Badge, Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { ConfirmDialog, Dialog } from "../components/Dialog";
import { CollectionDialog } from "../components/CollectionDialog";
import { ExternalLink as ExternalAnchor } from "../components/ExternalLink";

export function Collections() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CollectionDetail | "new" | null>(null);
  const [deleting, setDeleting] = useState<Collection | null>(null);
  const [previewing, setPreviewing] = useState<{ name: string; html: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const list = useQuery({ queryKey: ["collections"], queryFn: () => api.listCollections(), retry: false });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["collections"] }); qc.invalidateQueries({ queryKey: ["overview"] }); };
  const fail = (e: unknown) => setNotice({ tone: "bad", text: (e as Error).message });

  const open = useMutation({ mutationFn: (c: Collection) => api.getCollection(c.id), onSuccess: setEditing, onError: fail });
  const del = useMutation({
    mutationFn: (c: Collection) => api.deleteCollection(c.id),
    onSuccess: () => { setDeleting(null); setNotice({ tone: "ok", text: "Collection deleted." }); refresh(); },
    onError: (e) => { setDeleting(null); fail(e); },
  });
  const dup = useMutation({ mutationFn: (c: Collection) => api.duplicateCollection(c.id), onSuccess: () => { setNotice({ tone: "ok", text: "Collection duplicated as an unpublished draft." }); refresh(); }, onError: fail });
  const preview = useMutation({ mutationFn: async (c: Collection) => ({ name: c.name, html: (await api.previewCollection(c.id)).html }), onSuccess: setPreviewing, onError: fail });
  const publish = useMutation({ mutationFn: (c: Collection) => api.updateCollection(c.id, { isPublished: !c.isPublished }), onSuccess: refresh, onError: fail });
  const copy = async (c: Collection) => { await navigator.clipboard.writeText(c.publicUrl).then(() => setNotice({ tone: "ok", text: "Link copied." }), () => setNotice({ tone: "bad", text: "Couldn't copy the link." })); };

  const items = list.data?.items ?? [];
  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Collections</h1>
          <p className="mt-1 text-sm text-muted">{list.data ? `${items.length} collection${items.length === 1 ? "" : "s"}` : "Curated, shareable product pages."}</p>
        </div>
        <Button onClick={() => setEditing("new")}><Plus size={14} /> New collection</Button>
      </div>
      {notice && <p role="status" className={`mt-4 text-sm ${notice.tone === "ok" ? "text-ok" : "text-bad"}`}>{notice.text}</p>}
      {list.isLoading && <p className="mt-8 text-sm text-muted">Loading collections…</p>}
      {list.isError && (
        <Card className="mt-6 border-amber-200 bg-amber-50 text-sm"><div className="font-medium">Couldn't load collections</div><div className="mt-0.5 text-muted">{(list.error as Error).message}</div>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => list.refetch()}>Retry</Button></Card>
      )}
      {list.isSuccess && items.length === 0 && (
        <Card className="mt-6 text-center text-sm"><div className="font-medium">No collections yet</div><p className="mt-1 text-muted">Create one, add products, then publish it to get a public link.</p></Card>
      )}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((c) => (
          <Card key={c.id} role="article" aria-label={c.name} className="overflow-hidden p-0">
            <div className="h-36 bg-stone-100">{c.previewImageUrl ? <img src={c.previewImageUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted"><ImageOff size={22} aria-label="No image" /></div>}</div>
            <div className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2"><div className="font-medium">{c.name}</div>{c.isPublished ? <Badge tone="ok">Published</Badge> : <Badge>Draft</Badge>}</div>
              <div className="text-xs text-muted">{c.productCount} product{c.productCount === 1 ? "" : "s"} · /c/{c.slug}</div>
              <div className="flex flex-wrap items-center gap-1">
                <Button variant="ghost" size="sm" aria-label={`Edit ${c.name}`} onClick={() => open.mutate(c)} disabled={open.isPending}><Pencil size={14} /></Button>
                <Button variant="ghost" size="sm" aria-label={`Preview ${c.name}`} onClick={() => preview.mutate(c)} disabled={preview.isPending}><Eye size={14} /></Button>
                <Button variant="ghost" size="sm" aria-label={`Duplicate ${c.name}`} onClick={() => dup.mutate(c)} disabled={dup.isPending}><Copy size={14} /></Button>
                {c.isPublished && <><Button variant="ghost" size="sm" aria-label={`Copy link for ${c.name}`} title="Copy public link" onClick={() => copy(c)}><LinkIcon size={14} /></Button>
                  <ExternalAnchor aria-label={`Open ${c.name}`} href={c.publicUrl} className="inline-flex h-8 items-center px-2 text-muted hover:text-ink"><ExternalLink size={14} /></ExternalAnchor></>}
                <Button variant="ghost" size="sm" aria-label={`Delete ${c.name}`} className="ml-auto text-bad" onClick={() => setDeleting(c)}><Trash2 size={14} /></Button>
              </div>
              <button className="text-xs text-muted underline" onClick={() => publish.mutate(c)} disabled={publish.isPending}>{c.isPublished ? "Unpublish" : "Publish"}</button>
            </div>
          </Card>
        ))}
      </div>
      {editing && <CollectionDialog collection={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {deleting && <ConfirmDialog title="Delete collection?" message={`“${deleting.name}” and its public page will be removed. Products are not deleted.`} busy={del.isPending} onConfirm={() => del.mutate(deleting)} onCancel={() => setDeleting(null)} />}
      {previewing && (
        <Dialog title={`Preview — ${previewing.name}`} onClose={() => setPreviewing(null)} wide>
          <p className="mb-2 text-xs text-muted">Shows the saved version, as visitors would see it. Not tracked.</p>
          <iframe title="Collection preview" sandbox="" srcDoc={previewing.html} className="h-[60vh] w-full rounded-md border border-border" />
        </Dialog>
      )}
    </div>
  );
}
