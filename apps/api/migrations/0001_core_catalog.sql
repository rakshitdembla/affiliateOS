-- Products, collections and their many-to-many relationship.
PRAGMA foreign_keys = ON;

CREATE TABLE products (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  description         TEXT,
  image_url           TEXT,
  cached_image_key    TEXT,                       -- R2 object key when cached
  price_minor         INTEGER CHECK (price_minor IS NULL OR price_minor >= 0), -- minor units (paise)
  currency            TEXT NOT NULL DEFAULT 'INR',
  platform            TEXT NOT NULL,              -- amazon | myntra | meesho | ... (extensible, validated in app)
  affiliate_url       TEXT NOT NULL,
  canonical_url       TEXT,
  extraction_status   TEXT NOT NULL DEFAULT 'pending'
                      CHECK (extraction_status IN ('pending','success','partial','failed','manual')),
  extraction_error    TEXT,
  last_extracted_at   TEXT,
  price_updated_at    TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_products_platform ON products(platform);
CREATE INDEX idx_products_active   ON products(is_active);
CREATE INDEX idx_products_created  ON products(created_at DESC);

CREATE TABLE collections (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  slug            TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
  description     TEXT,
  cover_image_key TEXT,
  is_published    INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_collections_published ON collections(is_published);

CREATE TABLE collection_products (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL REFERENCES products(id)    ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  added_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (collection_id, product_id)
);
CREATE INDEX idx_cp_product ON collection_products(product_id);
CREATE INDEX idx_cp_order   ON collection_products(collection_id, position);
