-- PartSelect agent schema — PostgreSQL dialect (RDS).
-- Logical shape is identical to schema.sql; only dialect differs:
--   SERIAL ids, TIMESTAMPTZ defaults, DOUBLE PRECISION money, BYTEA embeddings.

CREATE TABLE IF NOT EXISTS appliance_models (
  id SERIAL PRIMARY KEY,
  model_no TEXT UNIQUE NOT NULL,
  brand TEXT NOT NULL,
  appliance_type TEXT NOT NULL CHECK (appliance_type IN ('refrigerator','dishwasher')),
  name TEXT,
  image_url TEXT
);

CREATE TABLE IF NOT EXISTS parts (
  id SERIAL PRIMARY KEY,
  part_no TEXT UNIQUE NOT NULL,
  mfr_part_no TEXT,
  name TEXT NOT NULL,
  description TEXT,
  appliance_type TEXT NOT NULL CHECK (appliance_type IN ('refrigerator','dishwasher')),
  brand TEXT,
  price DOUBLE PRECISION NOT NULL,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  product_url TEXT,
  symptoms TEXT
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
  tools TEXT,
  steps_json TEXT NOT NULL,
  video_url TEXT,
  video_thumb TEXT,
  manual_url TEXT
);

-- RAG chunks; embedding stored as Float32 LE bytes (BYTEA), in-process cosine.
-- A pgvector column (vector(1024)) is a drop-in upgrade once the extension is on.
CREATE TABLE IF NOT EXISTS doc_chunks (
  id SERIAL PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual','transcript','repair_guide','repair_story')),
  part_id INTEGER REFERENCES parts(id),
  appliance_type TEXT,
  symptom_tags TEXT,
  chunk_text TEXT NOT NULL,
  source_url TEXT,
  source_ref TEXT,
  embedding BYTEA
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  address_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_appliances (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  model_id INTEGER NOT NULL REFERENCES appliance_models(id),
  source TEXT NOT NULL DEFAULT 'purchased' CHECK (source IN ('purchased','searched')),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, model_id)
);

CREATE TABLE IF NOT EXISTS search_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  query TEXT,
  model_no TEXT,
  part_no TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  qty INTEGER NOT NULL DEFAULT 1,
  UNIQUE (user_id, part_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  total DOUBLE PRECISION NOT NULL,
  address_json TEXT,
  card_last4 TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  qty INTEGER NOT NULL,
  unit_price DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (order_id, part_id)
);

CREATE INDEX IF NOT EXISTS idx_parts_part_no ON parts(part_no);
CREATE INDEX IF NOT EXISTS idx_models_model_no ON appliance_models(model_no);
CREATE INDEX IF NOT EXISTS idx_chunks_part ON doc_chunks(part_id);
CREATE INDEX IF NOT EXISTS idx_history_user ON search_history(user_id);
