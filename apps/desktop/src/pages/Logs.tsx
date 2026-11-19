import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { LogItem } from "@affiliateos/shared";
import { api } from "../lib/api";
import { Badge, Card } from "../components/ui/card";
import { Button } from "../components/ui/button";

const LEVELS = ["error", "warn", "info"] as const;
const TONE = { error: "bad", warn: "warn", info: "neutral", debug: "neutral" } as const;
const sel = "h-8 rounded-md border border-border bg-surface px-2 text-sm";

export function Logs() {
  const [levels, setLevels] = useState<string[]>([]);
  const [module, setModule] = useState("");
  const [code, setCode] = useState("");
  const [entity, setEntity] = useState("");
  const [text, setText] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [more, setMore] = useState<LogItem[]>([]);
  const filters = { level: levels.join(","), module, code, entity: entity.trim(), q: text, from: from ? new Date(from).toISOString() : "", to: to ? new Date(to).toISOString() : "" };
  const logs = useQuery({ queryKey: ["logs", filters], queryFn: () => { setMore([]); return api.logs({ ...filters, limit: 100 }); }, refetchInterval: 15_000, retry: false });
  const items = [...(logs.data?.items ?? []), ...more];
  const loadMore = useMutation({ mutationFn: () => api.logs({ ...filters, limit: 100, before: items.at(-1)?.time }), onSuccess: (r) => setMore((m) => [...m, ...r.items]) });
  const toggleLevel = (l: string) => setLevels((ls) => (ls.includes(l) ? ls.filter((x) => x !== l) : [...ls, l]));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
        <p className="mt-1 text-sm text-muted">Everything the system did and why: sends, failures, retries, Instagram events and engine decisions. Secrets are never logged.</p>
      </div>
      <Card className="flex flex-wrap items-end gap-2 text-sm">
        <div className="flex gap-1" role="group" aria-label="Severity">{LEVELS.map((l) => <button key={l} aria-pressed={levels.includes(l)} onClick={() => toggleLevel(l)} className={`rounded-full border px-3 py-1 ${levels.includes(l) ? "border-ink bg-ink text-white" : "border-border"}`}>{l}</button>)}</div>
        <select aria-label="Module" value={module} onChange={(e) => setModule(e.target.value)} className={sel}><option value="">All modules</option>{logs.data?.facets.modules.map((m) => <option key={m}>{m}</option>)}</select>
        <select aria-label="Error type" value={code} onChange={(e) => setCode(e.target.value)} className={sel}><option value="">All error types</option>{logs.data?.facets.codes.map((m) => <option key={m}>{m}</option>)}</select>
        <input aria-label="Job or entity ID" value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="Job / entity ID" className={`${sel} w-56`} />
        <input aria-label="Search messages" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search…" className={`${sel} w-40`} />
        <label className="text-xs text-muted">From <input aria-label="From" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={sel} /></label>
        <label className="text-xs text-muted">To <input aria-label="To" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={sel} /></label>
        {(levels.length || module || code || entity || text || from || to) ? <Button variant="ghost" size="sm" onClick={() => { setLevels([]); setModule(""); setCode(""); setEntity(""); setText(""); setFrom(""); setTo(""); }}>Clear</Button> : null}
      </Card>
      <Card className="p-0">
        {logs.isError && <p className="p-4 text-sm text-bad">Couldn't load logs: {(logs.error as Error).message}</p>}
        {logs.isSuccess && items.length === 0 && <p className="p-6 text-center text-sm text-muted">No log entries match.</p>}
        {items.length > 0 && (
          <table className="w-full table-fixed text-left text-sm">
            <thead className="border-b border-border text-xs text-muted"><tr><th className="w-44 px-4 py-2">Time</th><th className="w-20">Level</th><th className="w-36">Module</th><th className="w-40">Type</th><th>Message</th></tr></thead>
            <tbody className="divide-y divide-border">
              {items.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="px-4 py-1.5 text-xs text-muted">{new Date(l.time).toLocaleString()}</td>
                  <td className="py-1.5"><Badge tone={TONE[l.level]}>{l.level}</Badge></td>
                  <td className="truncate py-1.5 text-xs">{l.module}{l.operation ? ` · ${l.operation}` : ""}</td>
                  <td className="truncate py-1.5 text-xs text-muted">{l.code ?? "—"}</td>
                  <td className="py-1.5">{l.message}{l.entityId && <button className="ml-2 text-xs text-muted underline" onClick={() => setEntity(l.entityId!)} title="Show everything for this item">{l.entityId.slice(0, 8)}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {logs.data && logs.data.items.length === 100 && <Button variant="outline" size="sm" onClick={() => loadMore.mutate()} disabled={loadMore.isPending}>{loadMore.isPending ? "Loading…" : "Load older entries"}</Button>}
    </div>
  );
}
