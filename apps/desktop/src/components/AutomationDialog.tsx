import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { DEFAULT_TEMPLATE, matchesAny, MATCH_MODES, parseKeywords, renderTemplate, validateTemplate, type Automation, type MatchMode } from "@affiliateos/shared";
import { api, getApiUrl } from "../lib/api";
import { Dialog } from "./Dialog";
import { Button } from "./ui/button";
import { Badge } from "./ui/card";

const field = "mt-1 h-9 w-full rounded-md border border-border px-3 text-sm";
const MODE_LABEL: Record<MatchMode, string> = { word: "Whole word (recommended)", contains: "Contains", exact: "Exact comment" };
const MODE_HELP: Record<MatchMode, string> = { word: "“link please” ✓ · “linked” ✗", contains: "matches inside other words: “linked” ✓", exact: "the whole comment must be the keyword: “LINK!” ✓ · “link pls” ✗" };

export function AutomationDialog({ automation, onClose, onSaved }: { automation?: Automation; onClose: () => void; onSaved: (warnings: string[]) => void }) {
  const qc = useQueryClient();
  const [mediaId, setMediaId] = useState(automation?.mediaId ?? "");
  const [reelName, setReelName] = useState(automation?.reelName ?? "");
  const [permalink, setPermalink] = useState<string | null>(automation?.mediaPermalink ?? null);
  const [collectionId, setCollectionId] = useState(automation?.collectionId ?? "");
  const [keywordText, setKeywordText] = useState(automation?.keywords.join(", ") ?? "LINK");
  const [matchMode, setMatchMode] = useState<MatchMode>(automation?.matchMode ?? "word");
  const [template, setTemplate] = useState(automation?.messageTemplate ?? DEFAULT_TEMPLATE);
  const [isActive, setIsActive] = useState(automation?.isActive ?? true);
  const [testComment, setTestComment] = useState("Can I get the link? 😍");
  const [error, setError] = useState<string | null>(null);

  const collections = useQuery({ queryKey: ["collections"], queryFn: () => api.listCollections() });
  const status = useQuery({ queryKey: ["instagram", "status"], queryFn: () => api.instagramStatus(), retry: false });
  const connected = status.data?.account?.status === "connected";
  const media = useQuery({ queryKey: ["instagram", "media"], queryFn: () => api.instagramMedia(), enabled: connected, retry: false });

  const keywords = useMemo(() => parseKeywords(keywordText), [keywordText]);
  const col = collections.data?.items.find((c) => c.id === collectionId);
  const sample = col ? { collectionUrl: `${getApiUrl()}/c/${col.slug}?s=instagram`, collectionName: col.name } : undefined;
  const check = validateTemplate(template, sample);
  const preview = sample ? renderTemplate(template, { ...sample, username: "shopper.handle" }) : null;
  const wouldTrigger = keywords.length > 0 && matchesAny(testComment, keywords, matchMode);

  const save = useMutation({
    mutationFn: () => {
      const body = { mediaId: mediaId.trim(), reelName: reelName.trim(), mediaPermalink: permalink, collectionId, keywords, matchMode, messageTemplate: template, isActive };
      return automation ? api.updateAutomation(automation.id, body) : api.createAutomation(body);
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["automations"] }); onSaved(r.warnings ?? []); onClose(); },
    onError: (e) => setError((e as Error).message),
  });

  const insert = (v: string) => setTemplate((t) => `${t}${t.endsWith(" ") || t.endsWith("\n") || !t ? "" : " "}[${v}]`);
  const canSave = mediaId.trim() && reelName.trim() && collectionId && keywords.length && check.ok;

  return (
    <Dialog title={automation ? "Edit automation" : "New automation"} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <section>
          <div className="font-medium">1. Reel or post</div>
          {connected && media.data && media.data.items.length > 0 && (
            <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6" role="listbox" aria-label="Recent posts">
              {media.data.items.slice(0, 12).map((m) => (
                <button key={m.id} type="button" role="option" aria-selected={mediaId === m.id} aria-label={m.caption?.slice(0, 40) ?? m.id}
                  onClick={() => { setMediaId(m.id); setPermalink(m.permalink); if (!reelName || reelName === mediaId) setReelName((m.caption ?? "").split("\n")[0]!.slice(0, 60) || `${m.mediaProductType ?? "Post"} ${m.timestamp?.slice(0, 10) ?? ""}`.trim()); }}
                  className={`aspect-square overflow-hidden rounded-md border-2 bg-stone-100 ${mediaId === m.id ? "border-ink" : "border-transparent"}`}>
                  {m.thumbnailUrl ? <img src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-muted">{m.mediaProductType}</span>}
                </button>
              ))}
            </div>
          )}
          {!connected && <p className="mt-1 text-xs text-muted">Connect Instagram to pick from your recent posts, or enter the media ID manually.</p>}
          <div className="mt-2 grid grid-cols-2 gap-3">
            <label className="block"><span className="text-muted">Media ID</span><input aria-label="Media ID" value={mediaId} onChange={(e) => setMediaId(e.target.value.trim())} className={field} placeholder="18000000000000000" /></label>
            <label className="block"><span className="text-muted">Display name</span><input aria-label="Display name" value={reelName} onChange={(e) => setReelName(e.target.value)} maxLength={200} className={field} placeholder="Winter outfit reel" /></label>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <label className="block"><span className="font-medium">2. Collection to send</span>
            <select aria-label="Collection" value={collectionId} onChange={(e) => setCollectionId(e.target.value)} className={field}>
              <option value="">Choose a collection…</option>
              {collections.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isPublished ? "" : " (unpublished)"}</option>)}
            </select>
            {col && !col.isPublished && <span className="mt-1 block text-xs text-warn">Publish this collection before activating, or people would get a dead link.</span>}
          </label>
          <div>
            <label className="block"><span className="font-medium">3. Trigger keywords</span>
              <input aria-label="Keywords" value={keywordText} onChange={(e) => setKeywordText(e.target.value)} className={field} placeholder="LINK, price" /></label>
            <div className="mt-1 flex flex-wrap gap-1">{keywords.map((k) => <Badge key={k}>{k}</Badge>)}</div>
          </div>
        </section>

        <section>
          <div className="font-medium">Matching</div>
          <div className="mt-1 flex flex-wrap gap-4" role="radiogroup" aria-label="Match mode">
            {MATCH_MODES.map((m) => (
              <label key={m} className="flex items-center gap-1.5"><input type="radio" name="mode" checked={matchMode === m} onChange={() => setMatchMode(m)} /> {MODE_LABEL[m]}</label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">Case-insensitive. {MODE_HELP[matchMode]}</p>
          <div className="mt-2 flex items-center gap-2">
            <input aria-label="Test a comment" value={testComment} onChange={(e) => setTestComment(e.target.value)} className="h-8 flex-1 rounded-md border border-border px-3 text-sm" />
            <span role="status" className={`flex items-center gap-1 text-xs ${wouldTrigger ? "text-ok" : "text-muted"}`}>{wouldTrigger ? <><Check size={13} /> Would trigger</> : <><X size={13} /> Would not trigger</>}</span>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <span className="font-medium">4. Message</span>
            <div className="flex gap-1">{["COLLECTION_URL", "COLLECTION_NAME", "USERNAME"].map((v) => <Button key={v} variant="outline" size="sm" onClick={() => insert(v)}>[{v}]</Button>)}</div>
          </div>
          <textarea aria-label="Message template" value={template} onChange={(e) => setTemplate(e.target.value)} rows={4} className="mt-1 w-full rounded-md border border-border px-3 py-2 font-mono text-xs" />
          <div className="flex justify-between text-xs">
            <span className={check.ok ? "text-muted" : "text-bad"}>{check.errors[0] ?? check.warnings[0] ?? "Template looks good."}</span>
            <span className={check.maxBytes > 1000 ? "text-bad" : "text-muted"}>up to {check.maxBytes} / 1000 bytes</span>
          </div>
          {preview && <div className="mt-2 whitespace-pre-wrap rounded-md bg-stone-50 p-3 text-sm" aria-label="Message preview">{preview}</div>}
          <p className="mt-1 text-xs text-muted">[USERNAME] is the commenter's handle from the comment; it's left out if Instagram doesn't provide one.</p>
        </section>

        <label className="flex items-center gap-2"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active (new matching comments are queued)</label>
        {error && <p role="alert" className="text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => { setError(null); save.mutate(); }} disabled={!canSave || save.isPending}>{save.isPending ? "Saving…" : "Save automation"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
