import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Activity, Cloud, AtSign, Layers, MousePointerClick, Package, Send, AlertTriangle, Plus } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Badge, Card } from "../components/ui/card";
import { Button } from "../components/ui/button";

function Stat({ icon: Icon, label, value, hint }: { icon: typeof Package; label: string; value: string; hint?: string }) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-sm text-muted"><Icon size={15} aria-hidden /> {label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export function Overview() {
  const health = useQuery({ queryKey: ["health"], queryFn: () => api.health(), refetchInterval: 30_000, retry: false });
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api.overview(), refetchInterval: 30_000, retry: false });
  const activity = useQuery({ queryKey: ["activity"], queryFn: () => api.activity(), retry: false });

  const o = overview.data;
  const dash = overview.isLoading ? "…" : "—";
  const num = (n: number | undefined) => (n === undefined ? dash : String(n));
  const authIssue = overview.error instanceof ApiError && ["no_token", "unauthorized", "auth_not_configured"].includes(overview.error.code);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <p className="mt-1 text-sm text-muted">Live numbers from your Cloudflare backend. A dash means the data could not be loaded.</p>

      {overview.error && (
        <Card className="mt-6 border-amber-200 bg-amber-50">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 text-warn" aria-hidden />
            <div className="text-sm">
              <div className="font-medium">{authIssue ? "Backend access not configured" : "Cannot load overview data"}</div>
              <div className="mt-0.5 text-muted">{(overview.error as Error).message}</div>
              <Link to="/settings" className="mt-2 inline-block font-medium underline">Open Settings</Link>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={Package} label="Products" value={num(o?.products)} />
        <Stat icon={Layers} label="Collections" value={num(o?.collections)} hint={o ? `${o.publishedCollections} published` : undefined} />
        <Stat icon={MousePointerClick} label="Total clicks" value={num(o?.clicks)} />
        <Stat icon={Send} label="Pending DMs" value={num(o?.pendingMessages)} hint={o ? `${o.failedMessages} failed · ${o.sentToday} sent today` : undefined} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium"><Cloud size={15} aria-hidden /> Backend health</div>
            {health.isLoading ? <Badge>Checking…</Badge> : health.data?.status === "ok" ? <Badge tone="ok">Healthy</Badge> : health.data ? <Badge tone="warn">Degraded</Badge> : <Badge tone="bad">Unreachable</Badge>}
          </div>
          <dl className="mt-3 space-y-1 text-sm text-muted">
            <div className="flex justify-between"><dt>Database (D1)</dt><dd>{health.data ? (health.data.checks.database.ok ? `OK · ${health.data.checks.database.latencyMs}ms` : "Down") : "—"}</dd></div>
            <div className="flex justify-between"><dt>Storage (R2)</dt><dd>{health.data ? (health.data.checks.storage.ok ? `OK · ${health.data.checks.storage.latencyMs}ms` : "Down") : "—"}</dd></div>
            <div className="flex justify-between"><dt>Version</dt><dd>{health.data?.version ?? "—"}</dd></div>
          </dl>
          {health.isError && <p className="mt-2 text-xs text-bad">{(health.error as Error).message}</p>}
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium"><AtSign size={15} aria-hidden /> Instagram</div>
            {o ? (o.instagram.connected ? <Badge tone="ok">Connected</Badge> : <Badge>Not connected</Badge>) : <Badge>Unknown</Badge>}
          </div>
          <p className="mt-3 text-sm text-muted">
            {o?.instagram.connected ? `Connected as @${o.instagram.username ?? "unknown"}.` : "No account linked yet. Instagram integration arrives in Phase 4."}
          </p>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <div className="flex items-center gap-2 text-sm font-medium"><Activity size={15} aria-hidden /> Recent activity</div>
          {activity.data && activity.data.items.length > 0 ? (
            <ul className="mt-3 divide-y divide-border text-sm">
              {activity.data.items.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  <Badge tone={a.level === "error" ? "bad" : a.level === "warn" ? "warn" : "neutral"}>{a.level}</Badge>
                  <span className="text-muted">{a.module}</span>
                  <span className="min-w-0 flex-1 truncate">{a.message}</span>
                  <time className="text-xs text-muted">{new Date(a.time).toLocaleString()}</time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">{activity.isError ? "Activity unavailable." : "No activity yet. Warnings and errors from the system will appear here."}</p>
          )}
        </Card>

        <Card>
          <div className="text-sm font-medium">Quick actions</div>
          <div className="mt-3 flex flex-col gap-2">
            <Button variant="outline" disabled title="Available in Phase 2"><Plus size={14} /> Add product</Button>
            <Button variant="outline" disabled title="Available in Phase 3"><Plus size={14} /> New collection</Button>
            <Button variant="outline" disabled title="Available in Phase 4"><AtSign size={14} /> Connect Instagram</Button>
          </div>
          <p className="mt-3 text-xs text-muted">Enabled as each phase ships.</p>
        </Card>
      </div>
    </div>
  );
}
