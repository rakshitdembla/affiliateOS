CREATE TABLE click_events (
  id            TEXT PRIMARY KEY,
  product_id    TEXT REFERENCES products(id)    ON DELETE SET NULL,
  collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  platform      TEXT,
  source        TEXT,
  is_bot        INTEGER NOT NULL DEFAULT 0 CHECK (is_bot IN (0,1)),
  clicked_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_clicks_time       ON click_events(clicked_at);
CREATE INDEX idx_clicks_product    ON click_events(product_id, clicked_at);
CREATE INDEX idx_clicks_collection ON click_events(collection_id, clicked_at);

CREATE TABLE app_logs (
  id        TEXT PRIMARY KEY,
  level     TEXT NOT NULL CHECK (level IN ('debug','info','warn','error')),
  module    TEXT NOT NULL,
  operation TEXT,
  entity_id TEXT,
  code      TEXT,
  message   TEXT NOT NULL,
  logged_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_logs_time  ON app_logs(logged_at DESC);
CREATE INDEX idx_logs_level ON app_logs(level, logged_at DESC);
