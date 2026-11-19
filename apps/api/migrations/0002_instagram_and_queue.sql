-- Instagram account, automations, durable webhook inbox and DM job queue.
PRAGMA foreign_keys = ON;

CREATE TABLE instagram_accounts (
  id                 TEXT PRIMARY KEY,
  ig_user_id         TEXT NOT NULL UNIQUE,
  username           TEXT,
  access_token_enc   TEXT NOT NULL,   -- AES-GCM encrypted; never stored in plaintext
  token_expires_at   TEXT,
  scopes             TEXT,
  status             TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','expired','revoked','error')),
  connected_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE automations (
  id               TEXT PRIMARY KEY,
  media_id         TEXT NOT NULL,
  reel_name        TEXT NOT NULL,
  collection_id    TEXT NOT NULL REFERENCES collections(id) ON DELETE RESTRICT,
  keywords         TEXT NOT NULL,                       -- JSON array of strings
  match_mode       TEXT NOT NULL DEFAULT 'contains' CHECK (match_mode IN ('exact','contains','word')),
  message_template TEXT NOT NULL,
  is_active        INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  last_run_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_automations_media ON automations(media_id, is_active);

-- Durable inbox: every verified webhook delivery is stored before anything else happens.
CREATE TABLE webhook_events (
  id             TEXT PRIMARY KEY,
  dedupe_key     TEXT NOT NULL UNIQUE,                 -- e.g. comment id; makes redelivery idempotent
  event_type     TEXT NOT NULL,
  payload        TEXT NOT NULL,                        -- raw JSON
  signature_ok   INTEGER NOT NULL CHECK (signature_ok IN (0,1)),
  process_status TEXT NOT NULL DEFAULT 'received'
                 CHECK (process_status IN ('received','queued','ignored','malformed','error')),
  error          TEXT,
  received_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_webhook_status ON webhook_events(process_status, received_at);

CREATE TABLE dm_jobs (
  id               TEXT PRIMARY KEY,
  comment_id       TEXT NOT NULL UNIQUE,               -- one job per comment: duplicate prevention
  media_id         TEXT NOT NULL,
  automation_id    TEXT REFERENCES automations(id) ON DELETE SET NULL,
  collection_id    TEXT REFERENCES collections(id) ON DELETE SET NULL,
  recipient_ref    TEXT,
  message          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','processing','sent','failed','skipped','uncertain')),
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  claimed_by       TEXT,                               -- desktop instance id
  claim_expires_at TEXT,                               -- lease; expired claims are recoverable
  next_retry_at    TEXT,
  last_attempt_at  TEXT,
  error_code       TEXT,
  error_message    TEXT,
  received_at      TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_dm_jobs_queue ON dm_jobs(status, next_retry_at);

CREATE TABLE dm_attempts (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES dm_jobs(id) ON DELETE CASCADE,
  attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  outcome     TEXT NOT NULL CHECK (outcome IN ('sent','retryable','permanent','uncertain','ineligible')),
  http_status INTEGER,
  error_code  TEXT,
  detail      TEXT                                      -- sanitized
);
CREATE INDEX idx_dm_attempts_job ON dm_attempts(job_id, attempted_at);
