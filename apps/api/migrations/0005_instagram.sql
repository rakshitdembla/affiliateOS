-- Phase 4: Instagram OAuth state, account details, normalized webhook columns, data-deletion requests.
CREATE TABLE oauth_states (
  state      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

ALTER TABLE instagram_accounts ADD COLUMN app_scoped_id TEXT;
ALTER TABLE instagram_accounts ADD COLUMN account_type TEXT;
ALTER TABLE instagram_accounts ADD COLUMN profile_picture_url TEXT;
ALTER TABLE instagram_accounts ADD COLUMN token_refreshed_at TEXT;
ALTER TABLE instagram_accounts ADD COLUMN webhooks_subscribed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE instagram_accounts ADD COLUMN last_checked_at TEXT;
ALTER TABLE instagram_accounts ADD COLUMN last_error TEXT;

ALTER TABLE webhook_events ADD COLUMN ig_user_id TEXT;
ALTER TABLE webhook_events ADD COLUMN media_id TEXT;
ALTER TABLE webhook_events ADD COLUMN comment_id TEXT;
ALTER TABLE webhook_events ADD COLUMN parent_comment_id TEXT;
ALTER TABLE webhook_events ADD COLUMN from_id TEXT;
ALTER TABLE webhook_events ADD COLUMN from_username TEXT;
ALTER TABLE webhook_events ADD COLUMN comment_text TEXT;
ALTER TABLE webhook_events ADD COLUMN signature_key TEXT;            -- which app secret verified it: instagram | meta
ALTER TABLE webhook_events ADD COLUMN delivery_count INTEGER NOT NULL DEFAULT 1; -- redeliveries of the same event
CREATE INDEX idx_webhook_comment ON webhook_events(comment_id);
CREATE INDEX idx_webhook_media   ON webhook_events(media_id, received_at);
CREATE INDEX idx_webhook_time    ON webhook_events(received_at DESC);

CREATE TABLE data_deletion_requests (
  code         TEXT PRIMARY KEY,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);
