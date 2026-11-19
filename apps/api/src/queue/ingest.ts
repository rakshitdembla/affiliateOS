import { matchesAny, MAX_MESSAGE_BYTES, PRIVATE_REPLY_WINDOW_MS, renderTemplate, type MatchMode, utf8Bytes } from "@affiliateos/shared";
import type { Env } from "../env";
import { log } from "../logger";
import { getAccount } from "../instagram/account";
import { WINDOW_MARGIN_MS } from "./policy";
import type { Row } from "./jobs";

export const collectionLink = (base: string, slug: string) => `${base}/c/${slug}?s=instagram`;

const keywordsOf = (json: string): string[] => {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
};

/**
 * Turn received comment events into DM jobs. Idempotent and safe to run concurrently: one job per comment
 * (UNIQUE comment_id), events only move out of "received" once. Runs right after a webhook delivery, at every
 * desktop sync, and from the daily cron as a safety net.
 */
export async function ingestEvents(env: Env, base: string, limit = 200): Promise<{ created: number; ignored: number }> {
  const out = { created: 0, ignored: 0 };
  const { results: events } = await env.DB.prepare(
    "SELECT * FROM webhook_events WHERE process_status = 'received' AND event_type IN ('comments','live_comments') ORDER BY received_at, rowid LIMIT ?",
  ).bind(limit).all<Row>();
  if (!events.length) return out;

  const account = await getAccount(env);
  const { results: autos } = await env.DB.prepare(
    `SELECT a.*, c.slug AS c_slug, c.name AS c_name, c.is_published AS c_published
     FROM automations a JOIN collections c ON c.id = a.collection_id WHERE a.is_active = 1 ORDER BY a.created_at, a.rowid`,
  ).all<Row>();
  const now = new Date();

  for (const ev of events) {
    const ignore = async (reason: string) => {
      await env.DB.prepare("UPDATE webhook_events SET process_status = 'ignored', error = ? WHERE id = ? AND process_status = 'received'").bind(reason, ev.id).run();
      out.ignored++;
    };
    const own = !!account && (
      (!!ev.from_id && (ev.from_id === account.ig_user_id || ev.from_id === account.app_scoped_id)) ||
      (!!ev.from_username && !!account.username && String(ev.from_username).toLowerCase() === String(account.username).toLowerCase()));
    if (own) { await ignore("Comment by your own account"); continue; }
    if (!ev.media_id) { await ignore("Comment event without a media id"); continue; }
    const candidates = autos.filter((a) => a.media_id === ev.media_id);
    if (!candidates.length) { await ignore("No active automation for this post"); continue; }
    // First matching automation wins (oldest first), so the result is deterministic.
    const auto = candidates.find((a) => matchesAny(ev.comment_text ?? "", keywordsOf(a.keywords), a.match_mode as MatchMode));
    if (!auto) { await ignore("Comment didn't match the trigger keywords"); continue; }

    const collectionUrl = collectionLink(base, auto.c_slug);
    const message = renderTemplate(auto.message_template, { collectionUrl, collectionName: auto.c_name, username: ev.from_username });
    let status = "pending";
    let outcome: string | null = null;
    let code: string | null = null;
    let msg: string | null = null;
    if (!auto.c_published) {
      [status, outcome, code, msg] = ["skipped", "ineligible", "collection_unavailable", "The linked collection is not published. Publish it, then retry this job."];
    } else if (utf8Bytes(message) > MAX_MESSAGE_BYTES) {
      [status, outcome, code, msg] = ["failed", "permanent", "invalid_message", `The message is ${utf8Bytes(message)} bytes; Instagram allows ${MAX_MESSAGE_BYTES}.`];
    } else if (now.getTime() - Date.parse(ev.received_at) > PRIVATE_REPLY_WINDOW_MS - WINDOW_MARGIN_MS) {
      [status, outcome, code, msg] = ["skipped", "ineligible", "window_expired", "Instagram only allows a private reply within 7 days of the comment."];
    } else if (ev.from_id) {
      const dup = await env.DB.prepare(
        "SELECT id FROM dm_jobs WHERE automation_id = ? AND recipient_ref = ? AND status IN ('pending','processing','sent','uncertain') AND received_at >= ? LIMIT 1",
      ).bind(auto.id, ev.from_id, new Date(now.getTime() - PRIVATE_REPLY_WINDOW_MS).toISOString()).first();
      if (dup) [status, outcome, code, msg] = ["skipped", "duplicate", "duplicate", "This person already has a reply queued or sent for this post."];
    }

    const jobId = crypto.randomUUID();
    const res = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO dm_jobs (id, comment_id, media_id, automation_id, collection_id, recipient_ref, recipient_username, comment_text, message,
           collection_url, status, outcome, error_code, error_message, received_at, webhook_event_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(comment_id) DO NOTHING`,
      ).bind(jobId, ev.comment_id, ev.media_id, auto.id, auto.collection_id, ev.from_id, ev.from_username, ev.comment_text, message,
        collectionUrl, status, outcome, code, msg, ev.received_at, ev.id),
      env.DB.prepare("UPDATE webhook_events SET process_status = 'queued', automation_id = ?, job_id = (SELECT id FROM dm_jobs WHERE comment_id = ?), error = NULL WHERE id = ?")
        .bind(auto.id, ev.comment_id, ev.id),
      env.DB.prepare("UPDATE automations SET last_run_at = ? WHERE id = ?").bind(now.toISOString(), auto.id),
    ]);
    if ((res[0]?.meta.changes ?? 0) > 0) out.created++;
  }
  if (out.created) await log(env, { level: "info", persist: true, module: "automation", operation: "ingest", message: `${out.created} new DM job(s) created from comments (${out.ignored} comment(s) not matched)` });
  return out;
}
