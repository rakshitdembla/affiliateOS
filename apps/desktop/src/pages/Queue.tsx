import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play, RefreshCw, Settings2 } from "lucide-react";
import { DM_STATUSES, type DmJob, type DmStatus } from "@affiliateos/shared";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";
import { engine, useEngine } from "../engine";
import { clampSettings, type EngineSettings } from "../engine/queueEngine";
import { ENGINE_LABEL, ENGINE_TONE, STATUS_TONE } from "../lib/queueLabels";
import { Badge, Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Dialog } from "../components/Dialog";
import { JobDialog } from "../components/JobDialog";


function SettingsDialog({ onClose }: { onClose: () => void }) {
  const snap = useEngine();
  const [s, setS] = useState<EngineSettings>(snap.settings);
  const row = (k: keyof EngineSettings, label: string, help: string) => (
    <label className="grid grid-cols-[1fr_6rem] items-center gap-3 py-1.5">
      <span><span className="block">{label}</span><span className="text-xs text-muted">{help}</span></span>
      <input aria-label={label} type="number" value={s[k]} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} className="h-8 rounded-md border border-border px-2 text-right text-sm" />
    </label>
  );
  return (
    <Dialog title="Processing settings" onClose={onClose}>
      <div className="divide-y divide-border text-sm">
        {row("sendSpacingSec", "Seconds between sends", "Minimum gap between two replies (≥ 5)")}
        {row("maxPerHour", "Max sends per hour", "Instagram allows 750/hour; the server never exceeds 700")}
        {row("pollIntervalSec", "Check for new comments every (s)", "When the queue is empty")}
        {row("batchSize", "Jobs claimed at a time", "1–20")}
        {row("maxAttempts", "Max attempts per reply", "For temporary errors, with exponential backoff")}
        {row("baseRetryDelaySec", "First retry after (s)", "Doubles each attempt, with jitter")}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => { engine.updateSettings(clampSettings(s)); onClose(); }}>Save</Button>
      </div>
    </Dialog>
  );
}

export function Queue() {
  const snap = useEngine();
  const [status, setStatus] = useState<DmStatus | "">("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<DmJob | null>(null);
  const [settings, setSettings] = useState(false);
  const jobs = useQuery({ queryKey: ["queue", "jobs", status, q], queryFn: () => api.queueJobs({ status, q, limit: 100 }), refetchInterval: snap.state === "sending" ? 3000 : 10_000, retry: false });
  const stats = jobs.data?.stats ?? snap.stats;
  const paused = snap.state === "paused";

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Message Queue</h1>
        <p className="mt-1 text-sm text-muted">Comments are queued in Cloudflare around the clock; this Mac sends the replies while AffiliateOS is open.</p>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={ENGINE_TONE[snap.state]}>{ENGINE_LABEL[snap.state]}{snap.state === "sending" && snap.current ? ` to @${snap.current.recipient ?? "…"}` : ""}</Badge>
          <span className="min-w-0 flex-1 text-sm text-muted">{snap.state === "cooldown" && snap.cooldownUntil ? `${snap.reason ?? "Rate limited"} — resumes ${timeAgo(snap.cooldownUntil)}` : snap.reason ?? (snap.lastSyncAt ? `Last checked ${timeAgo(snap.lastSyncAt)}` : "")}</span>
          <div className="flex gap-2">
            {paused ? <Button size="sm" onClick={() => engine.resume()}><Play size={13} /> Resume</Button> : <Button size="sm" variant="outline" onClick={() => engine.pause()} disabled={snap.state === "stopped"}><Pause size={13} /> Pause</Button>}
            <Button size="sm" variant="outline" onClick={() => { engine.processNow(); jobs.refetch(); }} disabled={paused || snap.state === "stopped"}><RefreshCw size={13} /> Process now</Button>
            <Button size="sm" variant="ghost" aria-label="Processing settings" onClick={() => setSettings(true)}><Settings2 size={14} /></Button>
          </div>
        </div>
        <div className="mt-2 text-xs text-muted">
          {snap.sentThisSession} sent this session · {stats ? `${stats.attemptsLastHour} send attempts in the last hour (limit ${Math.min(snap.settings.maxPerHour, stats.hourlyCap)})` : "—"} · one reply every ≥ {snap.settings.sendSpacingSec}s
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Filter by status">
        {(["", ...DM_STATUSES] as const).map((s) => (
          <button key={s || "all"} role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
            className={`rounded-full border px-3 py-1 text-sm ${status === s ? "border-ink bg-ink text-white" : "border-border bg-surface hover:bg-stone-50"}`}>
            {s ? s[0]!.toUpperCase() + s.slice(1) : "All"}{stats ? ` ${s ? stats.counts[s] : Object.values(stats.counts).reduce((a, b) => a + b, 0)}` : ""}
          </button>
        ))}
        <input aria-label="Search queue" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search @user or comment…" className="ml-auto h-8 w-60 rounded-md border border-border bg-surface px-3 text-sm" />
      </div>

      <Card className="p-0">
        {jobs.isError && <p className="p-4 text-sm text-bad">Couldn't load the queue: {(jobs.error as Error).message}</p>}
        {jobs.isSuccess && jobs.data.items.length === 0 && <p className="p-6 text-center text-sm text-muted">{status || q ? "No replies match this filter." : "The queue is empty. Replies appear here when someone comments a trigger keyword on an automated reel."}</p>}
        {!!jobs.data?.items.length && (
          <table className="w-full table-fixed text-left text-sm">
            <thead className="border-b border-border text-xs text-muted"><tr><th className="w-36 px-4 py-2">Received</th><th className="w-36">To</th><th>Comment</th><th className="w-48">Reel → collection</th><th className="w-44">Status</th><th className="w-16">Tries</th></tr></thead>
            <tbody className="divide-y divide-border">
              {jobs.data.items.map((j) => (
                <tr key={j.id} className="cursor-pointer align-top hover:bg-stone-50" onClick={() => setOpen(j)} aria-label={`Reply to ${j.recipientUsername ?? j.recipientId}`}>
                  <td className="px-4 py-2 text-xs text-muted">{timeAgo(j.receivedAt)}</td>
                  <td className="truncate py-2">@{j.recipientUsername ?? j.recipientId ?? "?"}</td>
                  <td className="truncate py-2" title={j.commentText ?? ""}>{j.commentText}</td>
                  <td className="truncate py-2 text-xs text-muted">{j.reelName ?? j.mediaId} → {j.collectionName ?? "—"}</td>
                  <td className="py-2"><Badge tone={STATUS_TONE[j.status]}>{j.status}</Badge>{j.errorCode && <div className="mt-0.5 truncate text-xs text-muted" title={j.errorMessage ?? ""}>{j.errorCode}{j.nextRetryAt && j.status === "pending" ? ` · retry ${timeAgo(j.nextRetryAt)}` : ""}</div>}</td>
                  <td className="py-2 text-xs">{j.attemptCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {snap.recent.length > 0 && (
        <Card>
          <div className="text-sm font-medium">This session</div>
          <ul className="mt-2 space-y-1 text-xs">
            {snap.recent.slice(0, 8).map((r) => (
              <li key={r.time + r.jobId} className="flex gap-2"><span className="w-20 text-muted">{new Date(r.time).toLocaleTimeString()}</span><Badge tone={r.outcome === "sent" ? "ok" : r.outcome === "uncertain" || r.outcome === "unknown" ? "warn" : "neutral"}>{r.outcome}</Badge><span>@{r.recipient ?? "?"}</span><span className="truncate text-muted">{r.message}</span></li>
            ))}
          </ul>
        </Card>
      )}
      {open && <JobDialog job={open} onClose={() => setOpen(null)} />}
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
    </div>
  );
}
