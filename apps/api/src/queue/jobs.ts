import type { DmAttempt, DmJob } from "@affiliateos/shared";
import type { Env } from "../env";

export type Row = Record<string, any>;

export const JOB_SELECT = `SELECT j.*, a.reel_name AS reel_name, c.name AS collection_name
  FROM dm_jobs j LEFT JOIN automations a ON a.id = j.automation_id LEFT JOIN collections c ON c.id = j.collection_id`;

export const toJob = (r: Row): DmJob => ({
  id: r.id, commentId: r.comment_id, mediaId: r.media_id, automationId: r.automation_id ?? null, reelName: r.reel_name ?? null,
  collectionId: r.collection_id ?? null, collectionName: r.collection_name ?? null, recipientId: r.recipient_ref ?? null,
  recipientUsername: r.recipient_username ?? null, commentText: r.comment_text ?? null, message: r.message, status: r.status,
  outcome: r.outcome ?? null, attemptCount: r.attempt_count, receivedAt: r.received_at, processedAt: r.processed_at ?? null,
  lastAttemptAt: r.last_attempt_at ?? null, nextRetryAt: r.next_retry_at ?? null, sentAt: r.sent_at ?? null,
  errorCode: r.error_code ?? null, errorMessage: r.error_message ?? null, claimedBy: r.claimed_by ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export const toAttempt = (r: Row): DmAttempt => ({
  id: r.id, attemptedAt: r.attempted_at, outcome: r.outcome, httpStatus: r.http_status ?? null, errorCode: r.error_code ?? null,
  graphCode: r.graph_code ?? null, graphSubcode: r.graph_subcode ?? null, detail: r.detail ?? null, durationMs: r.duration_ms ?? null, workerId: r.worker_id ?? null,
});

export const getJobRow = (env: Env, id: string) => env.DB.prepare(`${JOB_SELECT} WHERE j.id = ?`).bind(id).first<Row>();
