import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, getApiUrl, setApiUrl } from "../lib/api";
import { clearToken, getToken, isTauri, setToken } from "../lib/secrets";
import { Badge, Card } from "../components/ui/card";
import { Button } from "../components/ui/button";

export function Settings() {
  const qc = useQueryClient();
  const [url, setUrl] = useState(getApiUrl());
  const [token, setTokenValue] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => { getToken().then((t) => setHasToken(!!t)).catch(() => setHasToken(false)); }, []);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const clean = url.trim().replace(/\/+$/, "");
      new URL(clean);
      if (token.trim()) {
        // Verify against the backend before persisting anything.
        await api.overview({ token: token.trim(), baseUrl: clean });
        await setToken(token.trim());
        setHasToken(true); setTokenValue("");
      }
      setApiUrl(clean);
      await qc.invalidateQueries();
      setMsg({ tone: "ok", text: token.trim() ? "Connection verified and saved." : "API URL saved." });
    } catch (e) {
      setMsg({ tone: "bad", text: (e as Error).message || "Invalid URL" });
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm("Remove the stored API token from the macOS Keychain?")) return;
    await clearToken(); setHasToken(false); await qc.invalidateQueries();
    setMsg({ tone: "ok", text: "Token removed." });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Card className="mt-6 space-y-4">
        <div className="text-sm font-medium">Backend connection</div>
        <label className="block text-sm">
          <span className="text-muted">API URL</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border px-3 text-sm" />
        </label>
        <label className="block text-sm">
          <span className="flex items-center gap-2 text-muted">Admin API token {hasToken && <Badge tone="ok">Stored in Keychain</Badge>}</span>
          <input type="password" autoComplete="off" value={token} onChange={(e) => setTokenValue(e.target.value)} placeholder={hasToken ? "Leave blank to keep current token" : "Paste token"}
            disabled={!isTauri()} className="mt-1 h-9 w-full rounded-md border border-border px-3 text-sm disabled:bg-stone-50" />
        </label>
        {!isTauri() && <p className="text-xs text-warn">Secure token storage requires the desktop app (running in a plain browser).</p>}
        <div className="flex gap-2">
          <Button onClick={save} disabled={busy}>{busy ? "Verifying…" : "Save & test"}</Button>
          {hasToken && <Button variant="outline" onClick={remove} disabled={busy}>Remove token</Button>}
        </div>
        {msg && <p role="status" className={msg.tone === "ok" ? "text-sm text-ok" : "text-sm text-bad"}>{msg.text}</p>}
      </Card>
    </div>
  );
}
