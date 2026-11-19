import type { DmJob, QueueStats, RetryPolicy, SendResponse } from "@affiliateos/shared";

/**
 * Local DM processing engine. The queue lives in Cloudflare (D1); this engine decides when jobs are processed:
 * it claims due jobs (leased, atomic), paces and budgets sends, handles pause/resume, cooldowns and outages, and
 * asks the backend to perform each send with the server-held Instagram token. It never resends a job whose
 * result it didn't receive — the backend records every outcome (or marks it uncertain).
 */
export type EngineState = "stopped" | "idle" | "sending" | "paused" | "blocked" | "offline" | "cooldown";

export interface EngineSettings {
  pollIntervalSec: number;
  sendSpacingSec: number;
  maxPerHour: number;
  batchSize: number;
  maxAttempts: number;
  baseRetryDelaySec: number;
  maxRetryDelaySec: number;
}
export const DEFAULT_SETTINGS: EngineSettings = { pollIntervalSec: 30, sendSpacingSec: 6, maxPerHour: 200, batchSize: 5, maxAttempts: 5, baseRetryDelaySec: 60, maxRetryDelaySec: 3600 };
const LIMITS: Record<keyof EngineSettings, [number, number]> = {
  pollIntervalSec: [10, 600], sendSpacingSec: [5, 120], maxPerHour: [1, 700], batchSize: [1, 20], maxAttempts: [1, 10], baseRetryDelaySec: [10, 3600], maxRetryDelaySec: [60, 86_400],
};
export function clampSettings(s: Partial<EngineSettings>): EngineSettings {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(LIMITS) as (keyof EngineSettings)[]) {
    const v = Number(s[k] ?? DEFAULT_SETTINGS[k]);
    out[k] = Math.round(Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], Number.isFinite(v) ? v : DEFAULT_SETTINGS[k])));
  }
  return out;
}

export interface RecentOutcome { time: string; jobId: string; recipient: string | null; outcome: SendResponse["outcome"] | "unknown"; message: string | null }
export interface EngineSnapshot {
  state: EngineState;
  reason: string | null;
  workerId: string;
  settings: EngineSettings;
  stats: QueueStats | null;
  lastSyncAt: string | null;
  lastSendAt: string | null;
  cooldownUntil: string | null;
  current: { jobId: string; recipient: string | null } | null;
  sentThisSession: number;
  recent: RecentOutcome[];
}

export interface QueueApi {
  sync(body: { workerId: string; engineStatus: string; detail?: string; version?: string }): Promise<QueueStats>;
  claim(workerId: string, limit: number): Promise<{ jobs: DmJob[] }>;
  release(workerId: string): Promise<{ released: number }>;
  send(jobId: string, workerId: string, policy: RetryPolicy): Promise<SendResponse>;
  log(entry: { level: "info" | "warn" | "error"; operation: string; message: string; code?: string }): Promise<unknown>;
}

export interface EngineDeps {
  api: QueueApi;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  storage?: Pick<Storage, "getItem" | "setItem">;
  version?: string;
}

/** These clear up by themselves once Instagram is (re)connected; everything else needs a person to look first. */
const SELF_HEALING = new Set(["not_connected", "token_invalid", "token_unusable"]);
const K = { worker: "affiliateos.engine.workerId", settings: "affiliateos.engine.settings", paused: "affiliateos.engine.paused" };

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

const memoryStorage = (): Pick<Storage, "getItem" | "setItem"> => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

/** localStorage when it actually works; otherwise in-memory (settings then last only for this session). */
function pickStorage(): Pick<Storage, "getItem" | "setItem"> {
  try {
    const s = globalThis.localStorage;
    s.setItem("__affiliateos_probe", "1");
    if (s.getItem("__affiliateos_probe") !== "1") throw new Error("storage not persisting");
    s.removeItem("__affiliateos_probe");
    return s;
  } catch {
    return memoryStorage();
  }
}

export class QueueEngine {
  private snap: EngineSnapshot;
  private listeners = new Set<() => void>();
  private loop: Promise<void> | null = null;
  private stopFlag = false;
  private naps = new Map<AbortController, "poll" | "pace" | "cooldown">();
  private offlineDelay = 0;
  private lastSend = 0;
  private api: QueueApi;
  private now: () => number;
  private sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private random: () => number;
  private storage: Pick<Storage, "getItem" | "setItem">;
  private version: string;

  constructor(deps: EngineDeps) {
    this.api = deps.api;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? defaultSleep;
    this.random = deps.random ?? Math.random;
    this.storage = deps.storage ?? pickStorage();
    this.version = deps.version ?? "dev";
    let workerId = this.read(K.worker);
    if (!workerId) { workerId = crypto.randomUUID(); this.write(K.worker, workerId); }
    const paused = this.readJson<{ paused: boolean; reason: string | null }>(K.paused, { paused: false, reason: null });
    this.snap = {
      state: paused.paused ? "paused" : "stopped", reason: paused.paused ? paused.reason : null, workerId,
      settings: clampSettings(this.readJson(K.settings, {})), stats: null, lastSyncAt: null, lastSendAt: null,
      cooldownUntil: null, current: null, sentThisSession: 0, recent: [],
    };
  }

  // ---- public API ----
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snap;
  isRunning = () => this.loop !== null;

  start(): void {
    if (this.loop) return;
    this.stopFlag = false;
    if (this.isPaused()) { this.set({ state: "paused" }); return; }
    this.loop = this.run().catch((e) => { this.set({ state: "offline", reason: `Engine error: ${(e as Error).message}` }); }).finally(() => { this.loop = null; });
  }

  /** Stop the loop (app shutting down or token removed). Gives back unused claims. */
  async stop(): Promise<void> {
    this.stopFlag = true;
    this.wake("all");
    await this.loop;
    this.set({ state: this.isPaused() ? "paused" : "stopped", current: null });
  }

  pause(reason: string | null = null, byUser = true): void {
    this.write(K.paused, JSON.stringify({ paused: true, reason }));
    this.set({ state: "paused", reason });
    this.wake("all");
    void this.api.log({ level: byUser ? "info" : "warn", operation: byUser ? "pause" : "auto_pause", message: byUser ? "Queue processing paused" : `Queue processing paused automatically: ${reason}` }).catch(() => undefined);
  }

  resume(): void {
    this.write(K.paused, JSON.stringify({ paused: false, reason: null }));
    this.set({ state: "idle", reason: null, cooldownUntil: null });
    void this.api.log({ level: "info", operation: "resume", message: "Queue processing resumed" }).catch(() => undefined);
    this.start();
  }

  /** Check for work right away (does not shorten pacing or cooldowns). */
  processNow(): void { this.wake("poll"); }

  updateSettings(p: Partial<EngineSettings>): EngineSettings {
    const settings = clampSettings({ ...this.snap.settings, ...p });
    this.write(K.settings, JSON.stringify(settings));
    this.set({ settings });
    return settings;
  }

  // ---- internals ----
  private read(k: string) { try { return this.storage.getItem(k); } catch { return null; } }
  private write(k: string, v: string) { try { this.storage.setItem(k, v); } catch { /* best effort */ } }
  private readJson<T>(k: string, fallback: T): T { try { return { ...fallback, ...JSON.parse(this.read(k) ?? "null") }; } catch { return fallback; } }
  private isPaused() { return this.readJson(K.paused, { paused: false }).paused; }
  private set(p: Partial<EngineSnapshot>) { this.snap = { ...this.snap, ...p }; for (const l of this.listeners) l(); }
  private iso(t = this.now()) { return new Date(t).toISOString(); }

  private wake(kind: "poll" | "all") {
    for (const [ctl, k] of this.naps) if (kind === "all" || k === "poll") ctl.abort();
  }
  private async nap(ms: number, kind: "poll" | "pace" | "cooldown") {
    const ctl = new AbortController();
    this.naps.set(ctl, kind);
    try { await this.sleep(Math.max(0, ms), ctl.signal); } finally { this.naps.delete(ctl); }
  }
  private policy(): RetryPolicy {
    const s = this.snap.settings;
    return { maxAttempts: s.maxAttempts, baseDelaySeconds: s.baseRetryDelaySec, maxDelaySeconds: s.maxRetryDelaySec };
  }
  private record(job: DmJob, outcome: RecentOutcome["outcome"], message: string | null) {
    const entry: RecentOutcome = { time: this.iso(), jobId: job.id, recipient: job.recipientUsername, outcome, message };
    this.set({ recent: [entry, ...this.snap.recent].slice(0, 30) });
  }
  private cooldown(seconds: number, reason: string) {
    this.set({ state: "cooldown", cooldownUntil: this.iso(this.now() + seconds * 1000), reason });
    void this.api.log({ level: "warn", operation: "cooldown", code: "rate_limited", message: `${reason}. Sending resumes at ${this.iso(this.now() + seconds * 1000)}.` }).catch(() => undefined);
  }
  private async releaseClaims() { try { await this.api.release(this.snap.workerId); } catch { /* claims expire on the server */ } }
  private offline(e: unknown) {
    const wasOffline = this.snap.state === "offline";
    this.offlineDelay = Math.min(300_000, this.offlineDelay ? this.offlineDelay * 2 : 10_000);
    this.set({ state: "offline", reason: `Can't reach the backend (${(e as Error).message}). Retrying in ${Math.round(this.offlineDelay / 1000)}s.` });
    return wasOffline;
  }
  private authProblem(e: unknown) {
    const code = (e as { code?: string })?.code;
    return code === "unauthorized" || code === "no_token" || code === "auth_not_configured";
  }

  private async run(): Promise<void> {
    this.set({ state: "idle", reason: null });
    await this.releaseClaims(); // crash recovery: give back anything this install claimed before a restart
    while (!this.stopFlag && !this.isPaused()) {
      const s = this.snap.settings;
      const poll = s.pollIntervalSec * 1000;

      const cd = this.snap.cooldownUntil ? Date.parse(this.snap.cooldownUntil) - this.now() : 0;
      if (cd > 0) { this.set({ state: "cooldown" }); await this.nap(cd, "cooldown"); continue; }
      if (this.snap.cooldownUntil) this.set({ cooldownUntil: null });

      let stats: QueueStats;
      try {
        const wasOffline = this.snap.state === "offline";
        stats = await this.api.sync({ workerId: this.snap.workerId, engineStatus: this.snap.state, version: this.version });
        this.offlineDelay = 0;
        this.set({ stats, lastSyncAt: this.iso() });
        if (wasOffline) void this.api.log({ level: "info", operation: "online", message: "Backend reachable again; processing continues" }).catch(() => undefined);
      } catch (e) {
        if (this.authProblem(e)) { this.set({ state: "blocked", reason: "The backend rejected the API token. Update it in Settings." }); await this.nap(poll, "poll"); continue; }
        this.offline(e);
        await this.nap(this.offlineDelay, "poll");
        continue;
      }

      if (!stats.account.connected) {
        this.set({ state: "blocked", reason: stats.account.status === "expired" ? "The Instagram token expired. Reconnect on the Instagram page." : "Instagram is not connected. Connect it on the Instagram page." });
        await this.nap(poll, "poll");
        continue;
      }
      const budget = Math.min(s.maxPerHour, stats.hourlyCap) - stats.attemptsLastHour;
      if (budget <= 0) { this.cooldown(10 * 60, `Hourly limit of ${Math.min(s.maxPerHour, stats.hourlyCap)} sends reached`); continue; }
      if (stats.dueNow === 0) {
        this.set({ state: "idle", reason: stats.counts.pending ? `Waiting for scheduled retries${stats.nextRetryAt ? ` (next ${new Date(stats.nextRetryAt).toLocaleTimeString()})` : ""}` : null });
        await this.nap(poll, "poll");
        continue;
      }

      let jobs: DmJob[];
      try { jobs = (await this.api.claim(this.snap.workerId, Math.min(s.batchSize, budget))).jobs; }
      catch (e) { this.offline(e); await this.nap(this.offlineDelay, "poll"); continue; }
      if (!jobs.length) { await this.nap(poll, "poll"); continue; }

      this.set({ state: "sending", reason: null });
      for (const job of jobs) {
        if (this.stopFlag || this.isPaused()) break;
        const gap = this.lastSend + s.sendSpacingSec * 1000 + Math.round(this.random() * 1000) - this.now();
        if (this.lastSend && gap > 0) await this.nap(gap, "pace");
        if (this.stopFlag || this.isPaused()) break;

        this.set({ current: { jobId: job.id, recipient: job.recipientUsername } });
        let r: SendResponse;
        try {
          r = await this.api.send(job.id, this.snap.workerId, this.policy());
        } catch (e) {
          // The backend may or may not have sent it; it records the real outcome. Never resend from here.
          this.lastSend = this.now();
          this.record(job, "unknown", `Lost contact with the backend during this send (${(e as Error).message}). Its result will show after the next sync.`);
          this.set({ current: null });
          break;
        }
        this.lastSend = this.now();
        this.set({ current: null });
        this.record(job, r.outcome, r.message ?? r.stopEngine?.reason ?? null);
        if (r.outcome === "sent") this.set({ sentThisSession: this.snap.sentThisSession + 1, lastSendAt: this.iso() });
        if (r.outcome === "blocked" && r.stopEngine) {
          if (SELF_HEALING.has(r.stopEngine.code)) this.set({ state: "blocked", reason: r.stopEngine.reason });
          else this.pause(r.stopEngine.reason, false);
          break;
        }
        if (r.outcome === "rate_limited") { this.cooldown(r.retryAfterSeconds ?? 900, r.message ?? "Instagram rate limit reached"); break; }
      }
      await this.releaseClaims();
    }
    if (this.isPaused()) this.set({ state: "paused", current: null });
  }
}
