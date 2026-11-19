import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DmJob } from "@affiliateos/shared";
import { api } from "../lib/api";
import { Dialog } from "./Dialog";
import { Button } from "./ui/button";
import { Badge } from "./ui/card";
import { STATUS_TONE } from "../lib/queueLabels";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

export function JobDialog({ job: initial, onClose }: { job: DmJob; onClose: () => void }) {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const detail = useQuery({ queryKey: ["queue", "job", initial.id], queryFn: () => api.queueJob(initial.id), refetchInterval: 5000 });
  const job = detail.data?.job ?? initial;
  const done = (text: string) => { setNotice({ tone: "ok", text }); qc.invalidateQueries({ queryKey: ["queue"] }); qc.invalidateQueries({ queryKey: ["overview"] }); };
  const fail = (e: unknown) => setNotice({ tone: "bad", text: (e as Error).message });
  const action = useMutation({ mutationFn: (a: { kind: "retry" | "skip" | "mark-sent"; confirm?: boolean }) => api.queueAction(job.id, a.kind, a.confirm), onSuccess: (r) => { setConfirmRetry(false); done(r.message); }, onError: fail });
  const reconcile = useMutation({ mutationFn: () => api.queueReconcile(job.id), onSuccess: (r) => done(r.message), onError: fail });
  const busy = action.isPending || reconcile.isPending;

  return (
    <Dialog title={`Reply to @${job.recipientUsername ?? job.recipientId ?? "unknown"}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[job.status]}>{job.status}</Badge>
          {job.outcome && job.outcome !== job.status && <Badge>{job.outcome}</Badge>}
          <span className="text-muted">{job.reelName ?? job.mediaId} → {job.collectionName ?? "—"}</span>
        </div>
        {job.errorMessage && <p role="alert" className={`rounded-md p-2 ${job.status === "sent" ? "bg-green-50 text-ok" : "bg-amber-50 text-warn"}`}>{job.errorCode && <b>{job.errorCode}: </b>}{job.errorMessage}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          <div><div className="text-xs text-muted">Their comment</div><div className="mt-1 rounded-md bg-stone-50 p-2">{job.commentText ?? "—"}</div></div>
          <div><div className="text-xs text-muted">Reply</div><div className="mt-1 whitespace-pre-wrap rounded-md bg-stone-50 p-2">{job.message}</div></div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-3">
          <div><dt className="text-muted">Comment received</dt><dd>{fmt(job.receivedAt)}</dd></div>
          <div><dt className="text-muted">First processed</dt><dd>{fmt(job.processedAt)}</dd></div>
          <div><dt className="text-muted">Attempts</dt><dd>{job.attemptCount}</dd></div>
          <div><dt className="text-muted">Last attempt</dt><dd>{fmt(job.lastAttemptAt)}</dd></div>
          <div><dt className="text-muted">Next retry</dt><dd>{fmt(job.nextRetryAt)}</dd></div>
          <div><dt className="text-muted">Sent</dt><dd>{fmt(job.sentAt)}</dd></div>
        </dl>
        <div>
          <div className="text-xs font-medium text-muted">Attempt history</div>
          {detail.data?.attempts.length ? (
            <ol className="mt-1 space-y-1">
              {detail.data.attempts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted">{fmt(a.attemptedAt)}</span><Badge tone={a.outcome === "sent" ? "ok" : a.outcome === "uncertain" ? "warn" : a.outcome === "retryable" ? "warn" : "bad"}>{a.outcome}</Badge>
                  {a.httpStatus && <span>HTTP {a.httpStatus}</span>}{a.graphCode !== null && <span>Instagram code {a.graphCode}{a.graphSubcode ? `/${a.graphSubcode}` : ""}</span>}
                  {a.durationMs !== null && <span className="text-muted">{a.durationMs} ms</span>}<span className="min-w-0 flex-1 truncate" title={a.detail ?? ""}>{a.detail}</span>
                </li>
              ))}
            </ol>
          ) : <p className="mt-1 text-xs text-muted">No send attempts yet.</p>}
        </div>
        {notice && <p role="status" className={notice.tone === "ok" ? "text-ok" : "text-bad"}>{notice.text}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          {job.status === "uncertain" && (
            <>
              <Button variant="outline" onClick={() => reconcile.mutate()} disabled={busy}>{reconcile.isPending ? "Checking…" : "Check delivery with Instagram"}</Button>
              <Button variant="outline" onClick={() => action.mutate({ kind: "mark-sent" })} disabled={busy}>Mark as sent</Button>
              {!confirmRetry ? <Button variant="outline" onClick={() => setConfirmRetry(true)} disabled={busy}>Retry anyway…</Button>
                : <Button onClick={() => action.mutate({ kind: "retry", confirm: true })} disabled={busy}>Confirm retry</Button>}
            </>
          )}
          {(job.status === "failed" || job.status === "skipped") && job.errorCode !== "window_expired" && <Button onClick={() => action.mutate({ kind: "retry" })} disabled={busy}>Retry</Button>}
          {["pending", "failed", "uncertain"].includes(job.status) && <Button variant="ghost" onClick={() => action.mutate({ kind: "skip" })} disabled={busy}>Skip</Button>}
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
        {confirmRetry && <p className="text-xs text-warn">This reply may already have been delivered. Instagram allows only one private reply per comment, so a retry can't create a second DM, but it may fail. Checking delivery first is safer.</p>}
      </div>
    </Dialog>
  );
}
