CREATE TABLE collection_views (
  id            TEXT PRIMARY KEY,
  collection_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
  source        TEXT,
  is_bot        INTEGER NOT NULL DEFAULT 0 CHECK (is_bot IN (0,1)),
  viewed_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_views_collection ON collection_views(collection_id, viewed_at);
CREATE INDEX idx_views_time       ON collection_views(viewed_at);
