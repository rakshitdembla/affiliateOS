import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { Card } from "./ui/card";
import { Button } from "./ui/button";

const ICON = { ok: <CheckCircle2 size={15} className="text-ok" aria-label="OK" />, warn: <AlertTriangle size={15} className="text-warn" aria-label="Needs attention" />, error: <XCircle size={15} className="text-bad" aria-label="Problem" /> };

export function SystemHealth() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["system", "status"], queryFn: () => api.systemStatus(), refetchInterval: 60_000, retry: false });
  const backups = useQuery({ queryKey: ["system", "backups"], queryFn: () => api.backups(), retry: false });
  const backup = useMutation({ mutationFn: () => api.backupNow(), onSuccess: () => { qc.invalidateQueries({ queryKey: ["system"] }); } });

  return (
    <Card className="space-y-3">
      <div className="text-sm font-medium">System health</div>
      {status.isError && <p className="text-sm text-bad">Couldn't load status: {(status.error as Error).message}</p>}
      <ul className="space-y-2 text-sm" aria-label="System checks">
        {status.data?.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2">{ICON[c.status]}<span className="w-40 shrink-0">{c.label}</span><span className="text-muted">{c.detail}</span></li>
        ))}
      </ul>
      <div className="border-t border-border pt-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-medium">Backups</span>
          <Button size="sm" variant="outline" onClick={() => backup.mutate()} disabled={backup.isPending}>{backup.isPending ? "Backing up…" : "Back up now"}</Button>
        </div>
        <p className="mt-1 text-xs text-muted">Daily snapshot of every table to R2 (newest 14 kept), in addition to Cloudflare D1 Time Travel. Restore steps: DEPLOYMENT.md → “Restore”.</p>
        {backup.isError && <p role="alert" className="mt-1 text-bad">Backup failed: {(backup.error as Error).message}</p>}
        {backup.isSuccess && <p role="status" className="mt-1 text-ok">Backup saved ({(backup.data.bytes / 1024).toFixed(1)} KB).</p>}
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-muted" aria-label="Recent backups">
          {backups.data?.items.slice(0, 14).map((b) => <li key={b.key}>{new Date(b.uploaded).toLocaleString()} · {(b.size / 1024).toFixed(1)} KB · {b.rows} rows</li>)}
          {backups.data?.items.length === 0 && <li>No backups yet.</li>}
        </ul>
      </div>
    </Card>
  );
}
