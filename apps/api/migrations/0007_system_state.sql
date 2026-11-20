-- Phase 7: small key/value table for operational markers (last cron run, last backup).
CREATE TABLE system_state (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
