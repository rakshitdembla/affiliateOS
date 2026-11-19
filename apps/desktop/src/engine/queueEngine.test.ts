import { describe, expect, it } from "vitest";
import type { DmJob, DmStatus, QueueStats, SendResponse } from "@affiliateos/shared";
import { clampSettings, QueueEngine, type QueueApi } from "./queueEngine";

const job = (i: number): DmJob => ({
  id: `job-${i}`, commentId: `c${i}`, mediaId: "m", automationId: "a", reelName: "Reel", collectionId: "col", collectionName: "C",
  recipientId: `r${i}`, recipientUsername: `user${i}`, commentText: "link", message: "hi", status: "pending", outcome: null, attemptCount: 0,
  receivedAt: new Date(1_800_000_000_000 + i).toISOString(), processedAt: null, lastAttemptAt: null, nextRetryAt: null, sentAt: null,
  errorCode: null, errorMessage: null, claimedBy: null, createdAt: "", updatedAt: "",
});

interface Opts {
  jobs?: number;
  connected?: (syncNo: number) => boolean;
  syncFails?: (syncNo: number) => boolean;
  /** "lost-response": the server sent it but the reply never reached the app. "not-delivered": the request never reached the server. */
  onSend?: (id: string, n: number) => Partial<SendResponse> | "lost-response" | "not-delivered";
  attemptsLastHour?: number;
  stopWhen?: (s: { syncs: number; pending: number; sent: number }) => boolean;
}

/** In-memory backend + virtual clock: hours of pacing/cooldowns run in milliseconds. */
function harness(o: Opts = {}) {
  let clock = 1_800_000_000_000;
  const sleeps: number[] = [];
  const state = new Map<string, { job: DmJob; status: DmStatus; by?: string; started?: boolean; delivered: number }>();
  for (let i = 0; i < (o.jobs ?? 3); i++) state.set(`job-${i}`, { job: job(i), status: "pending", delivered: 0 });
  const calls = { syncs: 0, claims: 0, releases: 0, sends: [] as { id: string; at: number }[], logs: [] as any[] };
  const pending = () => [...state.values()].filter((j) => j.status === "pending");
  let engine!: QueueEngine;
  const api: QueueApi = {
    async sync() {
      calls.syncs++;
      if (o.syncFails?.(calls.syncs)) throw Object.assign(new Error("Could not reach the backend"), { code: "network" });
      const sent = [...state.values()].filter((j) => j.status === "sent").length;
      if ((o.stopWhen ?? ((s) => s.pending === 0 && s.syncs > 1))({ syncs: calls.syncs, pending: pending().length, sent }) || calls.syncs > 200) void engine.stop();
      const counts = { pending: 0, processing: 0, sent: 0, failed: 0, skipped: 0, uncertain: 0 } as Record<DmStatus, number>;
      for (const j of state.values()) counts[j.status]++;
      return {
        counts, dueNow: pending().length, nextRetryAt: null, attemptsLastHour: o.attemptsLastHour ?? calls.sends.length, hourlyCap: 700,
        account: { connected: o.connected ? o.connected(calls.syncs) : true, status: "connected", username: "me" }, ingested: { created: 0, ignored: 0 }, serverTime: "",
      } satisfies QueueStats;
    },
    async claim(w, limit) {
      calls.claims++;
      const due = pending().slice(0, limit);
      for (const j of due) { j.status = "processing"; j.by = w; }
      return { jobs: due.map((j) => j.job) };
    },
    async release(w) {
      calls.releases++;
      let n = 0;
      // Like the real server: only claims whose send never started go back to the queue.
      for (const j of state.values()) if (j.status === "processing" && j.by === w && !j.started) { j.status = "pending"; n++; }
      return { released: n };
    },
    async send(id) {
      calls.sends.push({ id, at: clock });
      const r = o.onSend?.(id, calls.sends.length) ?? { outcome: "sent" };
      const j = state.get(id)!;
      if (r === "not-delivered") throw new Error("connection refused");
      if (j.status !== "processing" || j.started) return { job: null, outcome: "not_claimed" } as SendResponse;
      j.started = true;
      if (r === "lost-response") { j.status = "sent"; j.delivered++; throw new Error("socket closed"); }
      if (r.outcome === "sent") j.delivered++;
      if (r.outcome === "rate_limited" || r.outcome === "blocked") j.started = false;
      j.status = r.outcome === "sent" ? "sent" : r.outcome === "rate_limited" || r.outcome === "blocked" ? "pending" : r.outcome === "uncertain" ? "uncertain" : "failed";
      return { job: null, outcome: "sent", ...r } as SendResponse;
    },
    async log(e) { calls.logs.push(e); },
  };
  const storage = new Map<string, string>();
  const make = () => new QueueEngine({
    api, now: () => clock, random: () => 0.5,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; await Promise.resolve(); },
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => void storage.set(k, v) },
  });
  engine = make();
  const run = async () => { engine.start(); for (let i = 0; i < 2000 && engine.isRunning(); i++) await new Promise((r) => setTimeout(r, 0)); };
  return { engine, calls, state, sleeps, run, clock: () => clock, remake: () => (engine = make()) };
}

describe("queue engine", () => {
  it("gives back stale claims on start, then sends due jobs oldest first with the configured spacing", async () => {
    const h = harness({ jobs: 3 });
    h.engine.updateSettings({ sendSpacingSec: 6 });
    await h.run();
    expect(h.calls.releases).toBeGreaterThan(0);
    expect(h.calls.sends.map((s) => s.id)).toEqual(["job-0", "job-1", "job-2"]);
    const gaps = h.calls.sends.slice(1).map((s, i) => s.at - h.calls.sends[i]!.at);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(6000);
    expect(h.engine.getSnapshot().sentThisSession).toBe(3);
  });

  it("pause stops before the next send, gives back claims, survives a restart; resume continues", async () => {
    const h = harness({ jobs: 3, onSend: (_id, n) => { if (n === 1) h.engine.pause(); return { outcome: "sent" }; } });
    await h.run();
    expect(h.calls.sends).toHaveLength(1);
    expect([...h.state.values()].filter((j) => j.status === "processing")).toHaveLength(0);
    expect(h.engine.getSnapshot().state).toBe("paused");
    const again = h.remake();
    again.start();
    expect(again.getSnapshot().state).toBe("paused");
    expect(again.isRunning()).toBe(false);
    again.resume();
    for (let i = 0; i < 2000 && again.isRunning(); i++) await new Promise((r) => setTimeout(r, 0));
    expect(h.calls.sends.map((s) => s.id)).toEqual(["job-0", "job-1", "job-2"]);
  });

  it("cools down for Instagram's suggested time on a rate limit", async () => {
    const h = harness({ jobs: 2, onSend: (_id, n) => (n === 1 ? { outcome: "rate_limited", retryAfterSeconds: 900 } : { outcome: "sent" }) });
    await h.run();
    const [first, second] = h.calls.sends;
    expect(second!.at - first!.at).toBeGreaterThanOrEqual(900_000);
    expect(h.calls.logs.some((l) => l.operation === "cooldown")).toBe(true);
  });

  it("waits while Instagram is disconnected and resumes by itself once reconnected", async () => {
    const h = harness({ jobs: 1, connected: (n) => n > 3 });
    await h.run();
    expect(h.calls.claims).toBeGreaterThan(0);
    expect(h.calls.sends).toHaveLength(1);
    expect(h.sleeps.slice(0, 3).every((ms) => ms === 30_000)).toBe(true);
  });

  it("auto-pauses on problems that need a person (e.g. Instagram's abuse warning) and does not resume by itself", async () => {
    const h = harness({ jobs: 3, onSend: () => ({ outcome: "blocked", stopEngine: { code: "abuse_warning", reason: "Instagram warned about bothersome messaging" } }), stopWhen: (s) => s.syncs > 5 });
    await h.run();
    expect(h.calls.sends).toHaveLength(1);
    const snap = h.engine.getSnapshot();
    expect(snap).toMatchObject({ state: "paused", reason: "Instagram warned about bothersome messaging" });
    expect(h.calls.logs.some((l) => l.operation === "auto_pause")).toBe(true);
  });

  it("an expired token blocks (self-healing) instead of pausing", async () => {
    let n = 0;
    const h = harness({ jobs: 1, onSend: () => (++n === 1 ? { outcome: "blocked", stopEngine: { code: "token_invalid", reason: "Reconnect Instagram" } } : { outcome: "sent" }) });
    await h.run();
    expect(h.calls.sends).toHaveLength(2); // retried automatically once the backend reports it connected again
  });

  it("backs off while the backend is unreachable (10s, 20s, 40s…) and recovers", async () => {
    const h = harness({ jobs: 1, syncFails: (n) => n <= 3 });
    await h.run();
    expect(h.sleeps.slice(0, 3)).toEqual([10_000, 20_000, 40_000]);
    expect(h.calls.sends).toHaveLength(1);
    expect(h.calls.logs.some((l) => l.operation === "online")).toBe(true);
  });

  it("never delivers twice when a send's response is lost", async () => {
    const h = harness({ jobs: 2, onSend: (_id, n) => (n === 1 ? "lost-response" : { outcome: "sent" }), stopWhen: (s) => s.syncs > 4 });
    await h.run();
    expect(h.state.get("job-0")!.delivered).toBe(1);
    expect(h.state.get("job-1")!.delivered).toBe(1);
    expect(h.engine.getSnapshot().recent.find((r) => r.jobId === "job-0")?.outcome).toBe("unknown");
  });

  it("sends later (exactly once) when a send request never reached the backend", async () => {
    const h = harness({ jobs: 1, onSend: (_id, n) => (n === 1 ? "not-delivered" : { outcome: "sent" }), stopWhen: (s) => s.syncs > 4 });
    await h.run();
    expect(h.state.get("job-0")!.delivered).toBe(1);
    expect(h.state.get("job-0")!.status).toBe("sent");
  });

  it("respects the hourly budget without claiming", async () => {
    const h = harness({ jobs: 2, attemptsLastHour: 200, stopWhen: (s) => s.syncs > 2 });
    await h.run();
    expect(h.calls.claims).toBe(0);
    expect(h.calls.sends).toHaveLength(0);
    expect(h.calls.logs.some((l) => l.operation === "cooldown")).toBe(true);
  });

  it("clamps settings to safe bounds", () => {
    expect(clampSettings({ sendSpacingSec: 0, maxPerHour: 5000, batchSize: 99 })).toMatchObject({ sendSpacingSec: 5, maxPerHour: 700, batchSize: 20 });
  });
});
