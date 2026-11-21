import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, RefreshCw, X } from "lucide-react";
import type { InstagramMedia, InstagramStatus } from "@affiliateos/shared";
import { api } from "../lib/api";
import { openExternal } from "../lib/open";
import { Badge, Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { ConfirmDialog } from "../components/Dialog";
import { ExternalLink } from "../components/ExternalLink";

const SETTING_HELP: Record<"unified" | "instagram", Record<string, string>> = {
  unified: {
    META_APP_ID: "Meta App ID — public; goes in wrangler.jsonc",
    FB_LOGIN_CONFIG_ID: "Facebook Login for Business configuration ID — public; wrangler.jsonc",
    META_APP_SECRET: "Meta App Secret — Worker secret (wrangler secret put META_APP_SECRET)",
    TOKEN_ENCRYPTION_KEY: "Token encryption key — Worker secret",
    IG_WEBHOOK_VERIFY_TOKEN: "Webhook verify token — Worker secret",
  },
  instagram: {
    IG_APP_ID: "Instagram App ID — public; goes in wrangler.jsonc",
    IG_APP_SECRET: "Instagram App Secret — Worker secret (wrangler secret put IG_APP_SECRET)",
    TOKEN_ENCRYPTION_KEY: "Token encryption key — Worker secret",
    IG_WEBHOOK_VERIFY_TOKEN: "Webhook verify token — Worker secret",
  },
};
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const daysLeft = (iso: string | null) => (iso ? Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000) : null);

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 py-1.5 text-sm">
      <span className="w-44 shrink-0 text-muted">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-stone-100 px-2 py-1 text-xs">{value}</code>
      <Button variant="ghost" size="sm" aria-label={`Copy ${label}`} onClick={() => navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => undefined)}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </Button>
    </div>
  );
}

function MetaSettings({ s }: { s: InstagramStatus }) {
  return (
    <Card>
      <div className="text-sm font-medium">Meta App Dashboard values</div>
      <p className="mt-1 text-xs text-muted">Paste these into your Meta app ({s.config.loginMode === "unified" ? "Facebook Login for Business settings, login configuration and Webhooks" : "Instagram → API setup with Instagram login"}). Graph API {s.config.graphVersion}.</p>
      <div className="mt-2 divide-y divide-border">
        <CopyField label="OAuth redirect URI" value={s.config.redirectUri} />
        <CopyField label="Webhook callback URL" value={s.config.webhookUrl} />
        <CopyField label="Deauthorize callback URL" value={s.config.deauthorizeUrl} />
        <CopyField label="Data deletion request URL" value={s.config.dataDeletionUrl} />
        <CopyField label="Privacy policy URL" value={s.config.privacyUrl} />
      </div>
    </Card>
  );
}

function Reels() {
  const [extra, setExtra] = useState<InstagramMedia[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const media = useQuery({ queryKey: ["instagram", "media"], queryFn: () => api.instagramMedia(), retry: false });
  useEffect(() => { if (media.data) { setExtra([]); setAfter(media.data.after); } }, [media.data]);
  const more = useMutation({ mutationFn: () => api.instagramMedia(after ?? undefined), onSuccess: (r) => { setExtra((x) => [...x, ...r.items]); setAfter(r.after); } });
  const items = [...(media.data?.items ?? []), ...extra];
  return (
    <Card>
      <div className="text-sm font-medium">Recent posts and reels</div>
      <p className="mt-1 text-xs text-muted">Media IDs are used to link a reel to a collection (automations, next phase).</p>
      {media.isLoading && <p className="mt-3 text-sm text-muted">Loading…</p>}
      {media.isError && <p className="mt-3 text-sm text-bad">Couldn't load media: {(media.error as Error).message}</p>}
      {media.isSuccess && items.length === 0 && <p className="mt-3 text-sm text-muted">No posts found on this account.</p>}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((m) => (
          <div key={m.id} className="overflow-hidden rounded-lg border border-border">
            <div className="aspect-square bg-stone-100">{m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />}</div>
            <div className="space-y-1 p-2 text-xs">
              <div className="flex items-center justify-between gap-1"><Badge>{m.mediaProductType ?? m.mediaType ?? "MEDIA"}</Badge><span className="text-muted">{m.timestamp ? new Date(m.timestamp).toLocaleDateString() : ""}</span></div>
              <div className="line-clamp-2 min-h-8">{m.caption ?? <span className="text-muted">No caption</span>}</div>
              <div className="flex items-center justify-between">
                <code className="truncate text-[10px] text-muted">{m.id}</code>
                {m.permalink && <ExternalLink href={m.permalink} className="text-muted underline">Open</ExternalLink>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {after && <Button variant="outline" size="sm" className="mt-3" onClick={() => more.mutate()} disabled={more.isPending}>{more.isPending ? "Loading…" : "Load more"}</Button>}
    </Card>
  );
}

function Events({ s }: { s: InstagramStatus }) {
  const events = useQuery({ queryKey: ["instagram", "events"], queryFn: () => api.instagramEvents(), refetchInterval: 30_000, retry: false });
  const tone = { received: "ok", queued: "ok", ignored: "neutral", malformed: "warn", error: "bad" } as const;
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Webhook events</div>
        <div className="text-xs text-muted">{s.webhooks.last24h} in the last 24 hours · {s.webhooks.total} total · last {fmt(s.webhooks.lastReceivedAt)}</div>
      </div>
      {events.isError && <p className="mt-3 text-sm text-bad">Couldn't load events: {(events.error as Error).message}</p>}
      {events.isSuccess && events.data.items.length === 0 && (
        <div className="mt-3 rounded-md bg-stone-50 p-3 text-sm text-muted">
          No webhook events received yet. Meta only delivers comment webhooks when the app is <b>Live</b>, the <b>comments</b> field is subscribed in the App Dashboard, and the Instagram account is <b>public</b>.
        </div>
      )}
      {!!events.data?.items.length && (
        <table className="mt-3 w-full table-fixed text-left text-sm">
          <thead className="text-xs text-muted"><tr><th className="w-40 py-1">Received</th><th className="w-36">From</th><th>Comment</th><th className="w-24">Status</th></tr></thead>
          <tbody className="divide-y divide-border">
            {events.data.items.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="py-1.5 text-xs text-muted">{fmt(e.receivedAt)}</td>
                <td className="truncate">{e.fromUsername ? `@${e.fromUsername}` : <span className="text-muted">{e.eventType}</span>}</td>
                <td className="truncate" title={e.text ?? e.error ?? ""}>{e.text ?? <span className="text-muted">{e.error ?? "—"}</span>}{e.deliveryCount > 1 && <span className="ml-1 text-xs text-muted">(delivered {e.deliveryCount}×)</span>}</td>
                <td><Badge tone={tone[e.status] ?? "neutral"}>{e.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function Instagram() {
  const qc = useQueryClient();
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const status = useQuery({
    queryKey: ["instagram", "status"], queryFn: () => api.instagramStatus(), retry: false,
    refetchInterval: waitingSince ? 3000 : 60_000,
  });
  const s = status.data;
  const a = s?.account ?? null;

  // While the user is signing in in the browser, poll until a newer connection appears (give up after 10 minutes).
  useEffect(() => {
    if (!waitingSince) return;
    if (a && Date.parse(a.connectedAt) >= waitingSince - 5000 && a.status === "connected") {
      setWaitingSince(null);
      setNotice({ tone: "ok", text: `Connected as @${a.username ?? a.igUserId}.` });
      qc.invalidateQueries({ queryKey: ["overview"] });
    } else if (Date.now() - waitingSince > 10 * 60_000) setWaitingSince(null);
  }, [a, waitingSince, qc]);

  const setStatus = (next: InstagramStatus) => qc.setQueryData(["instagram", "status"], next);
  const fail = (e: unknown) => setNotice({ tone: "bad", text: (e as Error).message });
  const connect = useMutation({
    mutationFn: async () => { const { authorizeUrl } = await api.connectInstagram(); await openExternal(authorizeUrl); },
    onSuccess: () => { setNotice(null); setWaitingSince(Date.now()); },
    onError: fail,
  });
  const action = (fn: () => Promise<InstagramStatus>, ok: string) => ({
    mutationFn: fn,
    onSuccess: (next: InstagramStatus) => { setStatus(next); setNotice({ tone: "ok", text: ok }); qc.invalidateQueries({ queryKey: ["overview"] }); },
    onError: (e: unknown) => { fail(e); qc.invalidateQueries({ queryKey: ["instagram", "status"] }); },
  });
  const check = useMutation(action(() => api.checkInstagram(), "Connection checked — Instagram accepted the token."));
  const subscribe = useMutation(action(() => api.subscribeInstagram(), "Subscribed to comment webhooks."));
  const refresh = useMutation(action(() => api.refreshInstagramToken(), "Token refreshed."));
  const disconnect = useMutation({ ...action(() => api.disconnectInstagram(), "Instagram disconnected and the stored token deleted."), onSettled: () => setConfirmDisconnect(false) });
  const busy = check.isPending || subscribe.isPending || refresh.isPending || disconnect.isPending || connect.isPending;
  const left = daysLeft(a?.tokenExpiresAt ?? null);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Instagram</h1>
        <p className="mt-1 text-sm text-muted">Official Instagram API with Instagram Login. Comments arrive by webhook in Cloudflare, even while this Mac is off.</p>
      </div>
      {notice && <p role="status" className={`text-sm ${notice.tone === "ok" ? "text-ok" : "text-bad"}`}>{notice.text}</p>}
      {status.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {status.isError && (
        <Card className="border-amber-200 bg-amber-50 text-sm"><div className="font-medium">Couldn't load Instagram status</div><div className="mt-0.5 text-muted">{(status.error as Error).message}</div>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => status.refetch()}>Retry</Button></Card>
      )}

      {s && !s.config.ready && (
        <Card className="border-amber-200">
          <div className="flex items-center gap-2 text-sm font-medium"><AlertTriangle size={16} className="text-warn" aria-hidden /> Finish the server setup</div>
          <ul className="mt-3 space-y-1.5 text-sm" aria-label="Setup checklist">
            {Object.keys(SETTING_HELP[s.config.loginMode ?? "instagram"]).map((k) => {
              const missing = s.config.missing.includes(k);
              return (
                <li key={k} className="flex items-center gap-2">
                  {missing ? <X size={14} className="text-bad" aria-label="missing" /> : <Check size={14} className="text-ok" aria-label="configured" />}
                  <span className={missing ? "" : "text-muted"}>{SETTING_HELP[s.config.loginMode ?? "instagram"][k]}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted">See DEPLOYMENT.md → “Instagram setup” for the exact steps.</p>
        </Card>
      )}

      {s && (
        <Card>
          {!a ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">No account connected</div>
                <p className="mt-0.5 text-sm text-muted">{waitingSince ? "Finish signing in to Instagram in your browser — this page updates automatically." : s.config.loginMode === "unified" ? "Sign in with Meta in your browser and share the Instagram professional account you post reels from." : "Connect the Instagram professional account you post reels from."}</p>
              </div>
              <div className="flex gap-2">
                {waitingSince && <Button variant="ghost" onClick={() => setWaitingSince(null)}>Stop waiting</Button>}
                <Button onClick={() => connect.mutate()} disabled={!s.config.ready || busy}>{connect.isPending ? "Opening…" : waitingSince ? "Open login again" : "Connect Instagram"}</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                {a.profilePictureUrl ? <img src={a.profilePictureUrl} alt="" className="h-12 w-12 rounded-full border border-border object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-lg">{(a.username ?? "?")[0]?.toUpperCase()}</div>}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">@{a.username ?? a.igUserId}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    <Badge tone={a.status === "connected" ? "ok" : "bad"}>{a.status === "connected" ? "Connected" : a.status === "expired" ? "Token expired" : a.status}</Badge>
                    {a.accountType && <Badge>{a.accountType}</Badge>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {a.status !== "connected" && <Button onClick={() => connect.mutate()} disabled={busy || !s.config.ready}>Reconnect</Button>}
                  <Button variant="outline" size="sm" onClick={() => check.mutate()} disabled={busy}><RefreshCw size={13} className={check.isPending ? "animate-spin" : ""} /> Check connection</Button>
                  {a.loginMode !== "unified" && <Button variant="outline" size="sm" onClick={() => refresh.mutate()} disabled={busy}>Refresh token</Button>}
                  <Button variant="ghost" size="sm" className="text-bad" onClick={() => setConfirmDisconnect(true)} disabled={busy}>Disconnect</Button>
                </div>
              </div>
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex justify-between"><dt className="text-muted">Token valid until</dt><dd className={left !== null && left < 7 ? "text-bad" : ""}>{a.tokenExpiresAt ? `${new Date(a.tokenExpiresAt).toLocaleDateString()} (${left} days)` : a.loginMode === "unified" ? "Doesn't expire" : "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Token last refreshed</dt><dd>{fmt(a.tokenRefreshedAt)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Last checked</dt><dd>{fmt(a.lastCheckedAt)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Comment webhooks</dt><dd>{a.webhooksSubscribed ? <span className="text-ok">Subscribed</span> : <Button variant="outline" size="sm" onClick={() => subscribe.mutate()} disabled={busy}>Subscribe</Button>}</dd></div>
              </dl>
              <p className="text-xs text-muted">{a.loginMode === "unified" ? "Connected with Meta Unified login (system-user token owned by your business portfolio)." : "Tokens are refreshed automatically by a daily Cloudflare job when fewer than 20 days remain."} Permissions granted: {a.scopes.join(", ") || "—"}.</p>
              {a.lastError && <p role="alert" className="rounded-md bg-amber-50 p-2 text-sm text-warn">{a.lastError}</p>}
            </div>
          )}
        </Card>
      )}

      {s && <Events s={s} />}
      {a?.status === "connected" && <Reels />}
      {s && <MetaSettings s={s} />}

      {confirmDisconnect && a && (
        <ConfirmDialog title="Disconnect Instagram?" message={`@${a.username ?? a.igUserId} will be disconnected and its stored access token deleted. Comment webhooks will stop being processed until you reconnect.`}
          confirmLabel="Disconnect" busy={disconnect.isPending} onConfirm={() => disconnect.mutate()} onCancel={() => setConfirmDisconnect(false)} />
      )}
    </div>
  );
}
