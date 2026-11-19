import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink as ExternalIcon, Pencil, Plus, Trash2 } from "lucide-react";
import type { Automation } from "@affiliateos/shared";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";
import { Badge, Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { ConfirmDialog } from "../components/Dialog";
import { AutomationDialog } from "../components/AutomationDialog";
import { ExternalLink } from "../components/ExternalLink";

export function Automations() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Automation | "new" | null>(null);
  const [deleting, setDeleting] = useState<Automation | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const list = useQuery({ queryKey: ["automations"], queryFn: () => api.listAutomations(), retry: false, refetchInterval: 30_000 });
  const ig = useQuery({ queryKey: ["instagram", "status"], queryFn: () => api.instagramStatus(), retry: false });
  const fail = (e: unknown) => setNotice({ tone: "bad", text: (e as Error).message });
  const toggle = useMutation({
    mutationFn: (a: Automation) => api.updateAutomation(a.id, { isActive: !a.isActive }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["automations"] }); setNotice({ tone: r.warnings.length ? "warn" : "ok", text: [`“${r.reelName}” ${r.isActive ? "activated" : "paused"}.`, ...r.warnings].join(" ") }); },
    onError: fail,
  });
  const del = useMutation({
    mutationFn: (a: Automation) => api.deleteAutomation(a.id),
    onSuccess: () => { setDeleting(null); qc.invalidateQueries({ queryKey: ["automations"] }); setNotice({ tone: "ok", text: "Automation deleted. Already-queued replies are kept." }); },
    onError: (e) => { setDeleting(null); fail(e); },
  });
  const items = list.data?.items ?? [];
  const connected = ig.data?.account?.status === "connected";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
          <p className="mt-1 text-sm text-muted">When someone comments a trigger keyword on a reel, they get the linked collection by private reply.</p>
        </div>
        <Button onClick={() => setEditing("new")}><Plus size={14} /> New automation</Button>
      </div>
      {ig.isSuccess && !connected && (
        <Card className="mt-4 border-amber-200 bg-amber-50 text-sm">Instagram isn't connected. Automations can be set up now; comments are processed once you <Link to="/instagram" className="underline">connect Instagram</Link>.</Card>
      )}
      {notice && <p role="status" className={`mt-4 text-sm ${notice.tone === "ok" ? "text-ok" : notice.tone === "warn" ? "text-warn" : "text-bad"}`}>{notice.text}</p>}
      {list.isLoading && <p className="mt-8 text-sm text-muted">Loading automations…</p>}
      {list.isError && <Card className="mt-6 border-amber-200 bg-amber-50 text-sm"><div className="font-medium">Couldn't load automations</div><div className="mt-0.5 text-muted">{(list.error as Error).message}</div><Button variant="outline" size="sm" className="mt-3" onClick={() => list.refetch()}>Retry</Button></Card>}
      {list.isSuccess && items.length === 0 && (
        <Card className="mt-6 text-center text-sm"><div className="font-medium">No automations yet</div><p className="mt-1 text-muted">Create one to link a reel and a keyword (like “LINK”) to a collection.</p></Card>
      )}
      <div className="mt-6 space-y-3">
        {items.map((a) => (
          <Card key={a.id} role="article" aria-label={a.reelName} className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.reelName}</span>
                {a.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Paused</Badge>}
                {!a.collectionPublished && <Badge tone="warn">Collection unpublished</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
                <span>Comment</span>{a.keywords.map((k) => <Badge key={k}>{k}</Badge>)}<span>({a.matchMode}) → {a.collectionName ?? "deleted collection"}</span>
              </div>
              <div className="mt-1 text-xs text-muted">
                {a.stats.matched} matched · {a.stats.sent} sent · {a.stats.pending} pending · {a.stats.failed} failed · last triggered {timeAgo(a.lastRunAt)} · media {a.mediaId}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {a.mediaPermalink && <ExternalLink href={a.mediaPermalink} aria-label={`Open ${a.reelName} on Instagram`} className="inline-flex h-8 items-center px-2 text-muted hover:text-ink"><ExternalIcon size={14} /></ExternalLink>}
              <Button variant="outline" size="sm" onClick={() => toggle.mutate(a)} disabled={toggle.isPending}>{a.isActive ? "Pause" : "Activate"}</Button>
              <Button variant="ghost" size="sm" aria-label={`Edit ${a.reelName}`} onClick={() => setEditing(a)}><Pencil size={14} /></Button>
              <Button variant="ghost" size="sm" aria-label={`Delete ${a.reelName}`} className="text-bad" onClick={() => setDeleting(a)}><Trash2 size={14} /></Button>
            </div>
          </Card>
        ))}
      </div>
      {editing && <AutomationDialog automation={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={(w) => setNotice({ tone: w.length ? "warn" : "ok", text: ["Automation saved.", ...w].join(" ") })} />}
      {deleting && <ConfirmDialog title="Delete automation?" message={`“${deleting.reelName}” will stop matching new comments. Replies already in the queue are kept and still sent.`} busy={del.isPending} onConfirm={() => del.mutate(deleting)} onCancel={() => setDeleting(null)} />}
    </div>
  );
}
