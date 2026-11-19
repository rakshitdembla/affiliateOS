-- Phase 5: automation display data, richer DM job/attempt records, webhook → job links, engine heartbeats.
ALTER TABLE automations ADD COLUMN media_permalink TEXT;

ALTER TABLE dm_jobs ADD COLUMN webhook_event_id TEXT;
ALTER TABLE dm_jobs ADD COLUMN recipient_username TEXT;
ALTER TABLE dm_jobs ADD COLUMN comment_text TEXT;
ALTER TABLE dm_jobs ADD COLUMN collection_url TEXT;
ALTER TABLE dm_jobs ADD COLUMN outcome TEXT;           -- sent | retryable | permanent | ineligible | duplicate | uncertain
ALTER TABLE dm_jobs ADD COLUMN processed_at TEXT;      -- first time a worker claimed the job
ALTER TABLE dm_jobs ADD COLUMN send_started_at TEXT;   -- set immediately before calling Instagram; if never finalized → uncertain
ALTER TABLE dm_jobs ADD COLUMN sent_at TEXT;
ALTER TABLE dm_jobs ADD COLUMN meta_message_id TEXT;
ALTER TABLE dm_jobs ADD COLUMN reconciled_at TEXT;
CREATE INDEX idx_dm_jobs_automation ON dm_jobs(automation_id, status);
CREATE INDEX idx_dm_jobs_recipient  ON dm_jobs(automation_id, recipient_ref, received_at);
CREATE INDEX idx_dm_jobs_updated    ON dm_jobs(updated_at DESC);
CREATE INDEX idx_dm_jobs_claims     ON dm_jobs(status, claim_expires_at);

ALTER TABLE dm_attempts ADD COLUMN worker_id TEXT;
ALTER TABLE dm_attempts ADD COLUMN duration_ms INTEGER;
ALTER TABLE dm_attempts ADD COLUMN graph_code INTEGER;
ALTER TABLE dm_attempts ADD COLUMN graph_subcode INTEGER;
CREATE INDEX idx_dm_attempts_time ON dm_attempts(attempted_at);

ALTER TABLE webhook_events ADD COLUMN automation_id TEXT;
ALTER TABLE webhook_events ADD COLUMN job_id TEXT;
CREATE INDEX idx_webhook_status_type ON webhook_events(process_status, event_type, received_at);

CREATE TABLE engine_heartbeats (
  worker_id TEXT PRIMARY KEY,
  status    TEXT NOT NULL,
  detail    TEXT,
  version   TEXT,
  seen_at   TEXT NOT NULL
);
