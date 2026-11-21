import { MAX_MESSAGE_BYTES, PRIVATE_REPLY_WINDOW_MS, normalizeText, type DmJob, type RetryPolicy, type SendResponse, utf8Bytes } from "@affiliateos/shared";
import type { Env } from "../env";
import { log } from "../logger";
import { accountToken, getAccount, targetFor } from "../instagram/account";
import { igConfig } from "../instagram/config";
import { recentMessagesWith, sendPrivateReply } from "../instagram/graph";
import { collectionLink } from "./ingest";
import { JOB_SELECT, getJobRow, toJob, type Row } from "./jobs";
import { backoffSeconds, clampPolicy, classifySendError, HOURLY_CAP, LEASE_MS, WINDOW_MARGIN_MS } from "./policy";

const UNCERTAIN_RECOVERED = "A send was started but its result was never recorded (the engine or network stopped mid-send). Check delivery before retrying.";
const WINDOW_EXPIRED = "Instagram only allows a private reply within 7 days of the comment.";
const iso = (d: Date) => d.toISOString();

/** Return abandoned claims to the queue; mark interrupted sends as uncertain; expire jobs past the 7-day window. */
export async function recoverStaleJobs(env: Env, now = new Date()) {
  const t = iso(now);
  const [released, uncertain, expired] = await env.DB.batch([
    env.DB.prepare("UPDATE dm_jobs SET status = 'pending', claimed_by = NULL, claim_expires_at = NULL, updated_at = ? WHERE status = 'processing' AND send_started_at IS NULL AND claim_expires_at < ?").bind(t, t),
    env.DB.prepare("UPDATE dm_jobs SET status = 'uncertain', outcome = 'uncertain', error_code = 'outcome_unknown', error_message = ?, claimed_by = NULL, claim_expires_at = NULL, updated_at = ? WHERE status = 'processing' AND send_started_at IS NOT NULL AND claim_expires_at < ?").bind(UNCERTAIN_RECOVERED, t, t),
    env.DB.prepare("UPDATE dm_jobs SET status = 'skipped', outcome = 'ineligible', error_code = 'window_expired', error_message = ?, updated_at = ? WHERE status = 'pending' AND received_at < ?").bind(WINDOW_EXPIRED, t, iso(new Date(now.getTime() - PRIVATE_REPLY_WINDOW_MS + WINDOW_MARGIN_MS))),
  ]);
  const r = { released: released!.meta.changes, uncertain: uncertain!.meta.changes, expired: expired!.meta.changes };
  if (r.uncertain) await log(env, { level: "warn", module: "queue", operation: "recover", code: "outcome_unknown", message: `${r.uncertain} job(s) were interrupted mid-send and marked uncertain` });
  if (r.expired) await log(env, { level: "warn", module: "queue", operation: "recover", code: "window_expired", message: `${r.expired} pending job(s) passed Instagram's 7-day private-reply window and were skipped` });
  return r;
}

/** Atomically claim due jobs for one engine (oldest first). */
export async function claimJobs(env: Env, workerId: string, limit: number, now = new Date()): Promise<DmJob[]> {
  await recoverStaleJobs(env, now);
  const t = iso(now);
  const { results } = await env.DB.prepare(
    `UPDATE dm_jobs SET status = 'processing', claimed_by = ?, claim_expires_at = ?, processed_at = COALESCE(processed_at, ?), updated_at = ?
     WHERE id IN (SELECT id FROM dm_jobs WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ?) ORDER BY received_at, rowid LIMIT ?)
     RETURNING id`,
  ).bind(workerId, iso(new Date(now.getTime() + LEASE_MS)), t, t, t, limit).all<{ id: string }>();
  if (!results.length) return [];
  const ids = results.map((r) => r.id);
  const rows = await env.DB.prepare(`${JOB_SELECT} WHERE j.id IN (${ids.map(() => "?").join(",")}) ORDER BY j.received_at, j.rowid`).bind(...ids).all<Row>();
  return rows.results.map(toJob);
}

export async function releaseJobs(env: Env, workerId: string): Promise<number> {
  const t = iso(new Date());
  const r = await env.DB.prepare("UPDATE dm_jobs SET status = 'pending', claimed_by = NULL, claim_expires_at = NULL, updated_at = ? WHERE status = 'processing' AND claimed_by = ? AND send_started_at IS NULL").bind(t, workerId).run();
  return r.meta.changes;
}

const response = async (env: Env, id: string, body: Omit<SendResponse, "job">): Promise<SendResponse> => {
  const row = await getJobRow(env, id);
  return { ...body, job: row ? toJob(row) : null };
};

/**
 * Send one claimed job. The engine on the Mac decides when; this performs the call with the server-held token.
 * `send_started_at` doubles as the attempt token: it is written before calling Instagram and every finalising
 * update is conditional on it, so a retried/duplicated request can never send twice.
 */
export async function sendJob(env: Env, base: string, id: string, workerId: string, policyIn: Partial<RetryPolicy> | undefined, now = new Date()): Promise<{ status: 200 | 404 | 409; body: SendResponse }> {
  const policy = clampPolicy(policyIn);
  const t = iso(now);
  const row = await getJobRow(env, id);
  if (!row) return { status: 404, body: { outcome: "not_claimed", job: null, message: "Job not found" } };
  const conflict = (message: string) => ({ status: 409 as const, body: { outcome: "not_claimed" as const, job: toJob(row), message } });
  if (row.status !== "processing" || row.claimed_by !== workerId) return conflict("This job is not claimed by this engine (it may already have been processed).");
  if (row.send_started_at) return conflict("A send for this job already started.");
  if (row.claim_expires_at && row.claim_expires_at < t) return conflict("The claim on this job expired; it will be picked up again.");

  const unclaimed = "WHERE id = ? AND status = 'processing' AND claimed_by = ? AND send_started_at IS NULL";
  const release = (code: string | null = null, message: string | null = null, nextRetryAt: string | null = null) =>
    env.DB.prepare(`UPDATE dm_jobs SET status = 'pending', claimed_by = NULL, claim_expires_at = NULL, next_retry_at = ?, error_code = COALESCE(?, error_code), error_message = COALESCE(?, error_message), updated_at = ? ${unclaimed}`)
      .bind(nextRetryAt, code, message, t, id, workerId).run();
  const settleWithoutSending = async (status: "skipped" | "failed", outcome: "ineligible" | "permanent", code: string, message: string) => {
    await env.DB.prepare(`UPDATE dm_jobs SET status = ?, outcome = ?, error_code = ?, error_message = ?, claimed_by = NULL, claim_expires_at = NULL, updated_at = ? ${unclaimed}`)
      .bind(status, outcome, code, message, t, id, workerId).run();
    await log(env, { level: "warn", module: "queue", operation: "send", entityId: id, code, message: `Not sent: ${message}` });
    return { status: 200 as const, body: await response(env, id, { outcome, message }) };
  };

  // Global preconditions — job stays queued, engine stops.
  const account = await getAccount(env);
  if (!account || account.status !== "connected") {
    await release();
    const stop = account ? { code: "token_invalid", reason: "The Instagram connection needs attention (token expired or revoked). Reconnect Instagram." } : { code: "not_connected", reason: "Instagram is not connected." };
    return { status: 200, body: await response(env, id, { outcome: "blocked", stopEngine: stop }) };
  }
  let token: string;
  try { token = await accountToken(env, account); } catch {
    await release();
    return { status: 200, body: await response(env, id, { outcome: "blocked", stopEngine: { code: "token_unusable", reason: "The stored Instagram token can't be decrypted (was the encryption key changed?). Reconnect Instagram." } }) };
  }
  const cap = await env.DB.prepare("SELECT COUNT(*) AS n, MIN(attempted_at) AS oldest FROM dm_attempts WHERE attempted_at >= ?").bind(iso(new Date(now.getTime() - 3_600_000))).first<{ n: number; oldest: string | null }>();
  if ((cap?.n ?? 0) >= HOURLY_CAP) {
    await release();
    const retryAfterSeconds = Math.max(60, Math.ceil((Date.parse(cap!.oldest!) + 3_600_000 - now.getTime()) / 1000));
    return { status: 200, body: await response(env, id, { outcome: "rate_limited", retryAfterSeconds, message: `Hourly safety limit of ${HOURLY_CAP} sends reached.` }) };
  }

  // Job-specific eligibility — decided without calling Instagram.
  if (now.getTime() - Date.parse(row.received_at) > PRIVATE_REPLY_WINDOW_MS - WINDOW_MARGIN_MS) return settleWithoutSending("skipped", "ineligible", "window_expired", WINDOW_EXPIRED);
  const col = row.collection_id ? await env.DB.prepare("SELECT slug, is_published FROM collections WHERE id = ?").bind(row.collection_id).first<Row>() : null;
  if (!col || !col.is_published) return settleWithoutSending("skipped", "ineligible", "collection_unavailable", "The linked collection is unpublished or was deleted. Publish it, then retry this job.");
  let message: string = row.message;
  const currentUrl = collectionLink(base, col.slug);
  if (row.collection_url && row.collection_url !== currentUrl) message = message.split(row.collection_url).join(currentUrl); // slug changed since queuing
  if (utf8Bytes(message) > MAX_MESSAGE_BYTES || !message.trim()) return settleWithoutSending("failed", "permanent", "invalid_message", `The message is empty or longer than ${MAX_MESSAGE_BYTES} bytes.`);

  // Mark the send as started (attempt token) — only one request can win this.
  const startedAt = t;
  const start = await env.DB.prepare(
    `UPDATE dm_jobs SET send_started_at = ?, attempt_count = attempt_count + 1, last_attempt_at = ?, claim_expires_at = ?, message = ?, collection_url = ?, updated_at = ? ${unclaimed}`,
  ).bind(startedAt, startedAt, iso(new Date(now.getTime() + LEASE_MS)), message, currentUrl, t, id, workerId).run();
  if (start.meta.changes !== 1) return conflict("Another request started this send first.");

  const t0 = Date.now();
  const result = await sendPrivateReply(targetFor(env, account), { token, version: igConfig(env, base).version, igUserId: account.ig_user_id, commentId: row.comment_id, text: message });
  const duration = Date.now() - t0;
  const attemptNo = row.attempt_count + 1;
  const done = iso(new Date());
  const mine = "WHERE id = ? AND send_started_at = ?";
  const attempt = (outcome: string, http: number | null, code: string | null, detail: string | null, gc: number | null = null, gs: number | null = null) =>
    env.DB.prepare("INSERT INTO dm_attempts (id, job_id, attempted_at, outcome, http_status, error_code, detail, worker_id, duration_ms, graph_code, graph_subcode) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), id, startedAt, outcome, http, code, detail, workerId, duration, gc, gs);
  const who = `@${row.recipient_username ?? row.recipient_ref ?? "unknown"}`;

  if (result.kind === "sent") {
    await env.DB.batch([
      env.DB.prepare(`UPDATE dm_jobs SET status = 'sent', outcome = 'sent', sent_at = ?, meta_message_id = ?, error_code = NULL, error_message = NULL, next_retry_at = NULL, claimed_by = NULL, claim_expires_at = NULL, updated_at = ? ${mine}`).bind(done, result.messageId, done, id, startedAt),
      attempt("sent", result.status, null, null),
    ]);
    await log(env, { level: "info", persist: true, module: "queue", operation: "send", entityId: id, message: `Private reply sent to ${who} (${row.reel_name ?? row.media_id})` });
    return { status: 200, body: await response(env, id, { outcome: "sent" }) };
  }

  if (result.kind === "uncertain") {
    await env.DB.batch([
      env.DB.prepare(`UPDATE dm_jobs SET status = 'uncertain', outcome = 'uncertain', error_code = 'outcome_unknown', error_message = ?, claimed_by = NULL, claim_expires_at = NULL, updated_at = ? ${mine}`).bind(result.reason, done, id, startedAt),
      attempt("uncertain", result.status, "outcome_unknown", result.reason),
    ]);
    await log(env, { level: "warn", module: "queue", operation: "send", entityId: id, code: "outcome_unknown", message: `Delivery to ${who} is uncertain: ${result.reason}` });
    return { status: 200, body: await response(env, id, { outcome: "uncertain", message: result.reason }) };
  }

  const e = result.error;
  const cl = classifySendError(e);
  const gc = e.code;
  const gs = e.subcode;
  if (cl.global) {
    const stmts = [
      env.DB.prepare(`UPDATE dm_jobs SET status = 'pending', send_started_at = NULL, next_retry_at = NULL, claimed_by = NULL, claim_expires_at = NULL, error_code = ?, error_message = ?, updated_at = ? ${mine}`).bind(cl.code, cl.message, done, id, startedAt),
      attempt("retryable", e.status, cl.code, cl.message, gc, gs),
    ];
    if (cl.code === "token_invalid") stmts.push(env.DB.prepare("UPDATE instagram_accounts SET status = 'expired', last_error = ?, updated_at = ? WHERE id = ?").bind(cl.message, done, account.id));
    await env.DB.batch(stmts);
    await log(env, { level: "error", module: "queue", operation: "send", entityId: id, code: cl.code, message: `Processing stopped: ${cl.message}` });
    return { status: 200, body: await response(env, id, { outcome: "blocked", stopEngine: { code: cl.code, reason: cl.message } }) };
  }
  if (cl.outcome === "retryable") {
    const exhausted = !cl.rateLimited && attemptNo >= policy.maxAttempts;
    const wait = Math.max(backoffSeconds(attemptNo, policy), cl.rateLimited ? result.retryAfterSeconds ?? 900 : 0);
    const next = iso(new Date(Date.now() + wait * 1000));
    await env.DB.batch([
      exhausted
        ? env.DB.prepare(`UPDATE dm_jobs SET status = 'failed', outcome = 'retryable', error_code = ?, error_message = ?, next_retry_at = NULL, claimed_by = NULL, claim_expires_at = NULL, updated_at = ? ${mine}`).bind(cl.code, `${cl.message} Gave up after ${attemptNo} attempts.`, done, id, startedAt)
        : env.DB.prepare(`UPDATE dm_jobs SET status = 'pending', outcome = 'retryable', send_started_at = NULL, error_code = ?, error_message = ?, next_retry_at = ?, claimed_by = NULL, claim_expires_at = NULL, updated_at = ? ${mine}`).bind(cl.code, cl.message, next, done, id, startedAt),
      attempt("retryable", e.status, cl.code, cl.message, gc, gs),
    ]);
    await log(env, { level: exhausted ? "error" : "warn", module: "queue", operation: "send", entityId: id, code: cl.code, message: exhausted ? `Gave up on ${who} after ${attemptNo} attempts: ${cl.message}` : `Will retry ${who} at ${next}: ${cl.message}` });
    return { status: 200, body: await response(env, id, cl.rateLimited ? { outcome: "rate_limited", retryAfterSeconds: wait, message: cl.message } : { outcome: "retryable", message: cl.message }) };
  }
  const status = cl.outcome === "ineligible" ? "skipped" : "failed";
  await env.DB.batch([
    env.DB.prepare(`UPDATE dm_jobs SET status = ?, outcome = ?, error_code = ?, error_message = ?, next_retry_at = NULL, claimed_by = NULL, claim_expires_at = NULL, updated_at = ? ${mine}`).bind(status, cl.outcome, cl.code, cl.message, done, id, startedAt),
    attempt(cl.outcome, e.status, cl.code, cl.message, gc, gs),
  ]);
  await log(env, { level: cl.outcome === "permanent" ? "error" : "warn", module: "queue", operation: "send", entityId: id, code: cl.code, message: `Not sent to ${who}: ${cl.message}` });
  return { status: 200, body: await response(env, id, { outcome: cl.outcome, message: cl.message }) };
}

/** Ask Instagram whether an uncertain reply actually arrived (Conversations API). Never sends anything. */
export async function reconcileJob(env: Env, id: string, now = new Date()): Promise<{ status: 200 | 404 | 409 | 503; result: "sent" | "not_sent" | "unknown"; message: string; job: DmJob | null }> {
  const row = await getJobRow(env, id);
  if (!row) return { status: 404, result: "unknown", message: "Job not found", job: null };
  if (row.status !== "uncertain") return { status: 409, result: "unknown", message: "Only uncertain jobs can be checked", job: toJob(row) };
  const startedAt = row.send_started_at ?? row.last_attempt_at;
  if (startedAt && now.getTime() - Date.parse(startedAt) < 60_000) return { status: 409, result: "unknown", message: "Wait at least a minute after the attempt before checking delivery.", job: toJob(row) };
  const account = await getAccount(env);
  if (!account || account.status !== "connected") return { status: 503, result: "unknown", message: "Connect Instagram to check delivery.", job: toJob(row) };
  if (!row.recipient_ref) return { status: 409, result: "unknown", message: "This job has no recipient id to look up.", job: toJob(row) };

  const t = iso(now);
  const keepUncertain = async (message: string) => {
    await env.DB.prepare("UPDATE dm_jobs SET error_message = ?, updated_at = ? WHERE id = ? AND status = 'uncertain'").bind(message, t, id).run();
    await log(env, { level: "warn", module: "queue", operation: "reconcile", entityId: id, code: "reconcile_inconclusive", message });
    return { status: 200 as const, result: "unknown" as const, message, job: toJob((await getJobRow(env, id))!) };
  };
  const notSent = async (message: string) => {
    await env.DB.prepare("UPDATE dm_jobs SET status = 'pending', outcome = NULL, send_started_at = NULL, next_retry_at = NULL, error_code = 'reconciled_not_sent', error_message = ?, reconciled_at = ?, updated_at = ? WHERE id = ? AND status = 'uncertain'").bind(message, t, t, id).run();
    await log(env, { level: "info", persist: true, module: "queue", operation: "reconcile", entityId: id, message });
    return { status: 200 as const, result: "not_sent" as const, message, job: toJob((await getJobRow(env, id))!) };
  };

  let found;
  try {
    found = await recentMessagesWith(targetFor(env, account), { token: await accountToken(env, account), version: igConfig(env, "https://x").version, userId: row.recipient_ref, since: Date.parse(startedAt ?? row.received_at) - 5 * 60_000 });
  } catch (e) {
    return keepUncertain(`Automatic delivery check failed: ${(e as Error).message}. Check the conversation in Instagram, then mark it as sent or retry.`);
  }
  if (found === "no_conversation") return notSent("Checked with Instagram: there is no conversation with this person, so the reply was not delivered. It is queued again.");
  const target = normalizeText(row.message);
  const ours = found.messages.find((m) => (m.fromId === account.ig_user_id || m.fromId === account.app_scoped_id || (!!m.fromUsername && m.fromUsername === account.username)) && normalizeText(m.text ?? "") === target);
  if (ours) {
    await env.DB.prepare("UPDATE dm_jobs SET status = 'sent', outcome = 'sent', sent_at = ?, meta_message_id = ?, error_code = NULL, error_message = 'Delivery confirmed with Instagram after an uncertain attempt.', reconciled_at = ?, updated_at = ? WHERE id = ? AND status = 'uncertain'")
      .bind(ours.createdTime ? iso(new Date(ours.createdTime)) : startedAt, ours.id, t, t, id).run();
    await log(env, { level: "info", persist: true, module: "queue", operation: "reconcile", entityId: id, message: "Uncertain reply confirmed as delivered" });
    return { status: 200, result: "sent", message: "Instagram shows the reply was delivered.", job: toJob((await getJobRow(env, id))!) };
  }
  if (found.truncated) return keepUncertain("The conversation has more than 20 newer messages, so Instagram can't show whether the reply arrived. Check it in Instagram, then mark it as sent or retry.");
  return notSent("Checked with Instagram: the reply is not in the conversation, so it was not delivered. It is queued again.");
}

export const MANUAL_ACTIONS = ["retry", "skip", "mark-sent"] as const;

/** Manual queue actions. In-flight ("processing") jobs can't be changed. */
export async function manualAction(env: Env, id: string, action: (typeof MANUAL_ACTIONS)[number], o: { confirm?: boolean } = {}, now = new Date()): Promise<{ status: 200 | 404 | 409; message: string; job: DmJob | null }> {
  const row = await getJobRow(env, id);
  if (!row) return { status: 404, message: "Job not found", job: null };
  const t = iso(now);
  const conflict = (message: string) => ({ status: 409 as const, message, job: toJob(row) });
  if (row.status === "processing") return conflict("This job is being processed right now.");
  let stmt: D1PreparedStatement;
  let note: string;
  if (action === "retry") {
    if (!["failed", "skipped", "uncertain"].includes(row.status)) return conflict("Only failed, skipped or uncertain jobs can be retried.");
    if (row.status === "uncertain" && !o.confirm) return conflict("This reply may already have been delivered. Check delivery first, or confirm the retry (Instagram allows only one private reply per comment, so a retry can't create a second DM, but it may fail).");
    if (now.getTime() - Date.parse(row.received_at) > PRIVATE_REPLY_WINDOW_MS - WINDOW_MARGIN_MS) return conflict(WINDOW_EXPIRED);
    stmt = env.DB.prepare("UPDATE dm_jobs SET status = 'pending', outcome = NULL, send_started_at = NULL, next_retry_at = NULL, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ? AND status = ?").bind(t, id, row.status);
    note = `Job queued again manually (was ${row.status})`;
  } else if (action === "skip") {
    if (!["pending", "failed", "uncertain"].includes(row.status)) return conflict("Only pending, failed or uncertain jobs can be skipped.");
    stmt = env.DB.prepare("UPDATE dm_jobs SET status = 'skipped', error_code = 'skipped_manually', error_message = 'Skipped manually.', next_retry_at = NULL, updated_at = ? WHERE id = ? AND status = ?").bind(t, id, row.status);
    note = "Job skipped manually";
  } else {
    if (row.status !== "uncertain") return conflict("Only uncertain jobs can be marked as sent.");
    stmt = env.DB.prepare("UPDATE dm_jobs SET status = 'sent', outcome = 'sent', sent_at = COALESCE(last_attempt_at, ?), error_code = NULL, error_message = 'Marked as sent manually after checking Instagram.', reconciled_at = ?, updated_at = ? WHERE id = ? AND status = 'uncertain'").bind(t, t, t, id);
    note = "Uncertain job marked as sent manually";
  }
  const r = await stmt.run();
  if (r.meta.changes !== 1) return conflict("The job changed in the meantime; refresh and try again.");
  await log(env, { level: "info", persist: true, module: "queue", operation: action, entityId: id, message: note });
  return { status: 200, message: note, job: toJob((await getJobRow(env, id))!) };
}
