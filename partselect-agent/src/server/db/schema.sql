-- PartSelect agent schema (SQLite dev dialect; PG migration notes inline)

CREATE TABLE IF NOT EXISTS appliance_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_no TEXT UNIQUE NOT NULL,
  brand TEXT NOT NULL,
  appliance_type TEXT NOT NULL CHECK (appliance_type IN ('refrigerator','dishwasher')),
  name TEXT,
  image_url TEXT
);

CREATE TABLE IF NOT EXISTS parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_no TEXT UNIQUE NOT NULL,            -- PartSelect number, e.g. PS11752778
  mfr_part_no TEXT,                        -- manufacturer number, e.g. WPW10321304
  name TEXT NOT NULL,
  description TEXT,
  appliance_type TEXT NOT NULL CHECK (appliance_type IN ('refrigerator','dishwasher')),
  brand TEXT,
  price REAL NOT NULL,
  stock_qty INTEGER NOT NULL DEFAULT 0,    -- stock quantity; 0 = out of stock
  image_url TEXT,
  product_url TEXT,
  symptoms TEXT                            -- comma-separated symptoms this part fixes
);

CREATE TABLE IF NOT EXISTS compatibility (
  part_id INTEGER NOT NULL REFERENCES parts(id),
  model_id INTEGER NOT NULL REFERENCES appliance_models(id),
  PRIMARY KEY (part_id, model_id)
);

CREATE TABLE IF NOT EXISTS install_guides (
  part_id INTEGER PRIMARY KEY REFERENCES parts(id),
  difficulty TEXT CHECK (difficulty IN ('easy','medium','hard')),
  est_time_minutes INTEGER,
  tools TEXT,                              -- comma-separated
  steps_json TEXT NOT NULL,                -- JSON array of step strings
  video_url TEXT,
  video_thumb TEXT,
  manual_url TEXT
);

-- RAG chunks; embedding stored as Float32 LE blob in SQLite, vector(N) in pgvector
CREATE TABLE IF NOT EXISTS doc_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual','transcript','repair_guide','repair_story')),
  part_id INTEGER REFERENCES parts(id),
  appliance_type TEXT,
  symptom_tags TEXT,
  chunk_text TEXT NOT NULL,
  source_url TEXT,
  source_ref TEXT,                         -- manual page / video timestamp
  embedding BLOB
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  name TEXT,
  address_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_appliances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  model_id INTEGER NOT NULL REFERENCES appliance_models(id),
  source TEXT NOT NULL DEFAULT 'purchased' CHECK (source IN ('purchased','searched')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, model_id)
);

CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  query TEXT,
  model_no TEXT,
  part_no TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS carts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  qty INTEGER NOT NULL DEFAULT 1,
  UNIQUE (user_id, part_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  total REAL NOT NULL,
  address_json TEXT,
  card_last4 TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  qty INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  PRIMARY KEY (order_id, part_id)
);

CREATE INDEX IF NOT EXISTS idx_parts_part_no ON parts(part_no);
CREATE INDEX IF NOT EXISTS idx_models_model_no ON appliance_models(model_no);
CREATE INDEX IF NOT EXISTS idx_chunks_part ON doc_chunks(part_id);
CREATE INDEX IF NOT EXISTS idx_history_user ON search_history(user_id);
