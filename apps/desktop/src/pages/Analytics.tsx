import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import type { Breakdown } from "@affiliateos/shared";
import { api, type AnalyticsQuery } from "../lib/api";
import { saveCsv } from "../lib/export";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { DailyChart } from "../components/DailyChart";

const PRESETS = [{ id: "7", label: "7 days" }, { id: "30", label: "30 days" }, { id: "90", label: "90 days" }, { id: "custom", label: "Custom" }] as const;
const METRICS = [{ id: "visits", label: "Visits" }, { id: "clicks", label: "Clicks" }, { id: "sent", label: "Replies sent" }, { id: "comments", label: "Comments" }] as const;
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 1000) / 10}%`);
const localDay = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return <Card role="group" aria-label={label}><div className="text-sm text-muted">{label}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>{hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}</Card>;
}

function BarList({ title, rows, valueKey = "clicks", empty }: { title: string; rows: (Breakdown & { visits?: number })[]; valueKey?: "clicks" | "visits"; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => (r[valueKey] ?? 0)));
  return (
    <Card>
      <div className="text-sm font-medium">{title}</div>
      {rows.length === 0 ? <p className="mt-2 text-sm text-muted">{empty}</p> : (
        <ul className="mt-3 space-y-2" aria-label={title}>
          {rows.map((r) => (
            <li key={r.key} className="text-sm">
              <div className="flex justify-between gap-2"><span className="truncate" title={r.label}>{r.label}</span><span className="tabular-nums text-muted">{r[valueKey] ?? 0}{valueKey === "clicks" && r.visits !== undefined ? ` · ${r.visits} visits` : ""}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-stone-100"><div className="h-1.5 rounded-full bg-stone-600" style={{ width: `${((r[valueKey] ?? 0) / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function Analytics() {
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["id"]>("30");
  const [fromDay, setFromDay] = useState(localDay(new Date(Date.now() - 29 * 86_400_000)));
  const [toDay, setToDay] = useState(localDay(new Date()));
  const [collectionId, setCollectionId] = useState("");
  const [metric, setMetric] = useState<(typeof METRICS)[number]["id"]>("clicks");
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const query: AnalyticsQuery = useMemo(() => {
    const tz = String(-new Date().getTimezoneOffset());
    if (preset === "custom") return { from: new Date(`${fromDay}T00:00:00`).toISOString(), to: new Date(`${toDay}T23:59:59.999`).toISOString(), tz, collectionId };
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (Number(preset) - 1));
    return { from: start.toISOString(), to: new Date().toISOString(), tz, collectionId };
  }, [preset, fromDay, toDay, collectionId]);

  const data = useQuery({ queryKey: ["analytics", query], queryFn: () => api.analytics(query), retry: false, refetchInterval: 60_000 });
  const collections = useQuery({ queryKey: ["collections"], queryFn: () => api.listCollections() });
  const exportCsv = useMutation({
    mutationFn: async (type: "daily" | "clicks" | "visits" | "messages") => {
      const csv = await api.analyticsExport(type, query);
      return saveCsv(`affiliateos-${type}-${query.from.slice(0, 10)}-to-${query.to.slice(0, 10)}.csv`, csv);
    },
    onSuccess: (where) => setNotice({ tone: "ok", text: `Exported to ${where}` }),
    onError: (e) => setNotice({ tone: "bad", text: `Export failed: ${(e as Error).message}` }),
  });
  const a = data.data;
  const t = a?.totals;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-muted">Human traffic only — crawlers and link previews are counted separately. Earnings and conversions aren't shown: no affiliate network reporting is connected.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Date range">
          {PRESETS.map((p) => <button key={p.id} aria-pressed={preset === p.id} onClick={() => setPreset(p.id)} className={`rounded-full border px-3 py-1 text-sm ${preset === p.id ? "border-ink bg-ink text-white" : "border-border bg-surface"}`}>{p.label}</button>)}
        </div>
        {preset === "custom" && <>
          <input aria-label="From date" type="date" value={fromDay} max={toDay} onChange={(e) => setFromDay(e.target.value)} className="h-8 rounded-md border border-border px-2 text-sm" />
          <input aria-label="To date" type="date" value={toDay} min={fromDay} onChange={(e) => setToDay(e.target.value)} className="h-8 rounded-md border border-border px-2 text-sm" />
        </>}
        <select aria-label="Collection filter" value={collectionId} onChange={(e) => setCollectionId(e.target.value)} className="h-8 rounded-md border border-border bg-surface px-2 text-sm">
          <option value="">All collections</option>{collections.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="ml-auto flex gap-1">
          {(["daily", "clicks", "visits", "messages"] as const).map((type) => <Button key={type} size="sm" variant="outline" onClick={() => exportCsv.mutate(type)} disabled={exportCsv.isPending || !a}><Download size={13} /> {type === "daily" ? "Daily CSV" : `${type[0]!.toUpperCase()}${type.slice(1)} CSV`}</Button>)}
        </div>
      </div>
      {notice && <p role="status" className={`text-sm ${notice.tone === "ok" ? "text-ok" : "text-bad"}`}>{notice.text}</p>}
      {data.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {data.isError && <Card className="border-amber-200 bg-amber-50 text-sm"><div className="font-medium">Couldn't load analytics</div><div className="mt-0.5 text-muted">{(data.error as Error).message}</div><Button variant="outline" size="sm" className="mt-3" onClick={() => data.refetch()}>Retry</Button></Card>}

      {a && t && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Tile label="Collection visits" value={t.visits} hint={t.botVisits ? `${t.botVisits} bot/preview visits excluded` : undefined} />
            <Tile label="Product clicks" value={t.clicks} hint={t.botClicks ? `${t.botClicks} bot clicks excluded` : undefined} />
            <Tile label="Clicks per visit" value={t.visits ? (t.clicks / t.visits).toFixed(2) : "—"} />
            <Tile label="Comments received" value={t.comments} hint={collectionId ? "matched to this collection" : "all posts"} />
            <Tile label="Replies sent" value={t.messagesSent} hint={`${t.messagesFailed} failed · ${t.messagesPending} pending`} />
            <Tile label="Reply success rate" value={pct(t.successRate)} hint="sent ÷ (sent + failed)" />
          </div>

          <Card>
            <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Chart metric">
              {METRICS.map((m) => <button key={m.id} aria-pressed={metric === m.id} onClick={() => setMetric(m.id)} className={`rounded-md px-2.5 py-1 text-sm ${metric === m.id ? "bg-stone-100 font-medium" : "text-muted"}`}>{m.label}</button>)}
            </div>
            <DailyChart data={a.daily} metric={metric} label={METRICS.find((m) => m.id === metric)!.label} />
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <BarList title="Clicks by platform" rows={a.byPlatform} empty="No clicks in this period." />
            <BarList title="Traffic by source" rows={a.bySource} empty="No traffic in this period." />
            <BarList title="Top products" rows={a.topProducts} empty="No product clicks in this period." />
            <Card>
              <div className="text-sm font-medium">Collections</div>
              {a.byCollection.length === 0 ? <p className="mt-2 text-sm text-muted">No collection traffic in this period.</p> : (
                <table className="mt-2 w-full text-left text-sm" aria-label="Collections performance">
                  <thead className="text-xs text-muted"><tr><th className="py-1">Collection</th><th className="text-right">Visits</th><th className="text-right">Clicks</th><th className="text-right">Clicks/visit</th></tr></thead>
                  <tbody className="divide-y divide-border">{a.byCollection.map((c) => <tr key={c.key}><td className="truncate py-1">{c.label}</td><td className="text-right tabular-nums">{c.visits}</td><td className="text-right tabular-nums">{c.clicks}</td><td className="text-right tabular-nums">{c.ctr === null ? "—" : c.ctr.toFixed(2)}</td></tr>)}</tbody>
                </table>
              )}
            </Card>
          </div>

          <Card>
            <div className="text-sm font-medium">Instagram replies in this period</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-sm md:grid-cols-6">
              {([["Queued", t.messagesQueued], ["Sent", t.messagesSent], ["Failed", t.messagesFailed], ["Skipped", t.messagesSkipped], ["Pending", t.messagesPending], ["Uncertain", t.messagesUncertain]] as const).map(([k, v]) => <div key={k}><div className="text-xs text-muted">{k}</div><div className="font-medium tabular-nums">{v}</div></div>)}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
