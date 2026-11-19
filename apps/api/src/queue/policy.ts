import type { RetryPolicy } from "@affiliateos/shared";
import type { GraphError } from "../instagram/graph";

/** Meta: 750 private replies per hour per account for posts and reels. Stay safely below it. */
export const HOURLY_CAP = 700;
/** How long a claim lasts before an idle job returns to the queue. */
export const LEASE_MS = 5 * 60_000;
/** Treat the 7-day private-reply window as closing a little early: received_at is only an approximation of comment time. */
export const WINDOW_MARGIN_MS = 15 * 60_000;
export const DEFAULT_POLICY: RetryPolicy = { maxAttempts: 5, baseDelaySeconds: 60, maxDelaySeconds: 3600 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));
export const clampPolicy = (p?: Partial<RetryPolicy>): RetryPolicy => ({
  maxAttempts: clamp(p?.maxAttempts ?? DEFAULT_POLICY.maxAttempts, 1, 10),
  baseDelaySeconds: clamp(p?.baseDelaySeconds ?? DEFAULT_POLICY.baseDelaySeconds, 10, 3600),
  maxDelaySeconds: clamp(p?.maxDelaySeconds ?? DEFAULT_POLICY.maxDelaySeconds, 60, 86_400),
});

/** Bounded exponential backoff with equal jitter (half fixed, half random). */
export function backoffSeconds(attempt: number, p: RetryPolicy, rand: () => number = Math.random): number {
  const d = Math.min(p.maxDelaySeconds, p.baseDelaySeconds * 2 ** Math.max(0, attempt - 1));
  return Math.max(1, Math.round(d / 2 + rand() * (d / 2)));
}

export interface Classified {
  outcome: "retryable" | "permanent" | "ineligible";
  code: string;
  message: string;
  /** Every further send would fail the same way (or risk the account): stop the engine, keep the job queued. */
  global?: boolean;
  rateLimited?: boolean;
}

/**
 * Map an explicit Instagram rejection to a queue decision.
 * Codes from Meta's Messenger Platform error-code reference (Instagram rows); unknown codes fall back to the error kind.
 */
export function classifySendError(e: GraphError): Classified {
  const c = e.code;
  const s = e.subcode;
  const m = e.message;
  if (e.kind === "token_invalid") return { outcome: "retryable", code: "token_invalid", message: `Instagram rejected the access token: ${m}. Reconnect Instagram.`, global: true };
  if (c === 613 && s === 2018338) return { outcome: "retryable", code: "abuse_warning", message: "Instagram warned that this messaging may be considered bothersome or abusive. Processing stopped to protect the account.", global: true };
  if (c === 200 && s === 2534041) return { outcome: "retryable", code: "messaging_access_disabled", message: "Message access is turned off for this Instagram account. In the Instagram app: Settings → Messages and story replies → Message controls → Connected tools → Allow access to messages.", global: true };
  if (c === 100 && s === 2534029) return { outcome: "retryable", code: "account_blocked", message: "Instagram has blocked this business from sending messages through the API.", global: true };
  if ((c === 10 && s === 2534077) || c === 36103) return { outcome: "retryable", code: "account_not_eligible", message: `Instagram can't use this account for messaging: ${m}`, global: true };

  if (c === 10 && (s === 2534022 || s === 2018278)) return { outcome: "ineligible", code: "window_expired", message: "Instagram says this is outside the allowed messaging window." };
  if (c === 10 && s === 2018108) return { outcome: "ineligible", code: "recipient_unavailable", message: "This person can't receive your messages right now." };
  if (c === 10 && (s === 2018300 || s === 2534037)) return { outcome: "ineligible", code: "thread_controlled_elsewhere", message: "Another app controls this conversation." };
  if (c === 551 || s === 1545041) return { outcome: "ineligible", code: "recipient_unavailable", message: "This person isn't available right now (they may have restricted messages from you)." };
  if (c === 100 && s === 2534025) return { outcome: "ineligible", code: "comment_ineligible", message: "Instagram says this comment can't receive a private reply (it may have been deleted or already replied to)." };
  if (c === 100 && (s === 2534014 || s === 2018001)) return { outcome: "permanent", code: "recipient_not_found", message: "Instagram couldn't find this person." };
  if (c === 100 && s === 2534015) return { outcome: "permanent", code: "invalid_message", message: "Instagram rejected the message content as invalid." };

  if (e.kind === "rate_limited" || (c !== null && c >= 80001 && c <= 80014)) return { outcome: "retryable", code: "rate_limited", message: `Instagram rate limit reached: ${m}`, rateLimited: true };
  if (e.kind === "temporary") return { outcome: "retryable", code: "instagram_error", message: `Instagram had a temporary problem: ${m}` };
  if (e.kind === "permission_missing") return { outcome: "retryable", code: "permission_missing", message: `Instagram denied permission: ${m}. Check the app's permissions and access level.`, global: true };
  if (e.kind === "invalid_request") return { outcome: "permanent", code: "invalid_request", message: `Instagram rejected the request: ${m}` };
  return { outcome: "retryable", code: "unknown_error", message: `Unexpected Instagram error: ${m}` };
}
