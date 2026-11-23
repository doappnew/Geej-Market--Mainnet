-- GÉEJ MARKET — schéma PostgreSQL (idempotent: peut être rejoué)
-- Les prix sont en FCFA (entiers). Les quantités sont NUMERIC (0.5 kg, etc.).

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  full_name     TEXT NOT NULL,
  phone         TEXT UNIQUE,
  email         TEXT UNIQUE,
  password_hash TEXT,
  pi_uid        TEXT UNIQUE,
  pi_username   TEXT,
  role          TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client','seller','admin')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (phone IS NOT NULL OR email IS NOT NULL OR pi_uid IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sellers (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  shop_name   TEXT NOT NULL,
  description TEXT,
  phone       TEXT,
  whatsapp    TEXT,
  city        TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admins (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  level      TEXT NOT NULL DEFAULT 'admin' CHECK (level IN ('admin','super_admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  image_url  TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS products (
  id             SERIAL PRIMARY KEY,
  seller_id      INTEGER NOT NULL REFERENCES sellers(id),
  category_id    INTEGER NOT NULL REFERENCES categories(id),
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  price          NUMERIC(14,7) NOT NULL CHECK (price >= 0),
  promo_price    NUMERIC(14,7) CHECK (promo_price IS NULL OR promo_price >= 0),
  unit           TEXT NOT NULL DEFAULT 'kg',       -- kg, demi-kg, pièce, lot, paquet, carton, ...
  unit_detail    TEXT,                             -- ex: "500 g"
  qty_step       NUMERIC(8,3) NOT NULL DEFAULT 1 CHECK (qty_step > 0),
  min_qty        NUMERIC(8,3) NOT NULL DEFAULT 1 CHECK (min_qty > 0),
  stock          NUMERIC(10,3) NOT NULL DEFAULT 0 CHECK (stock >= 0),
  condition      TEXT NOT NULL DEFAULT 'frais' CHECK (condition IN ('frais','congelé','fumé','séché','salé','autre')),
  storage_info   TEXT,                             -- ex: "0°C à 4°C"
  available_from DATE,
  prepared_on    DATE,
  traceability   TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  orders_count   INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS products_seller_idx ON products(seller_id);

CREATE TABLE IF NOT EXISTS product_images (
  id         SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS product_images_product_idx ON product_images(product_id, sort_order);

CREATE TABLE IF NOT EXISTS regions (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS departments (
  id        SERIAL PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  name      TEXT NOT NULL,
  UNIQUE (region_id, name)
);

CREATE TABLE IF NOT EXISTS addresses (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT NOT NULL DEFAULT 'Domicile',
  full_name    TEXT NOT NULL,
  phone        TEXT NOT NULL,
  region_id    INTEGER NOT NULL REFERENCES regions(id),
  department   TEXT NOT NULL,
  commune      TEXT NOT NULL,
  quartier     TEXT NOT NULL,
  address_line TEXT NOT NULL,
  landmark     TEXT,
  lat          NUMERIC(9,6),
  lng          NUMERIC(9,6),
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cart_items (
  id         SERIAL PRIMARY KEY,
  cart_id    INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity   NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
  UNIQUE (cart_id, product_id)
);

-- Zones de livraison configurées par vendeur (commune NULL = toute la région)
CREATE TABLE IF NOT EXISTS delivery_zones (
  id               SERIAL PRIMARY KEY,
  seller_id        INTEGER NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  region_id        INTEGER NOT NULL REFERENCES regions(id),
  commune          TEXT,
  fee              NUMERIC(14,7) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  eta_text         TEXT NOT NULL DEFAULT '24 h',
  min_order        NUMERIC(14,7) NOT NULL DEFAULT 0 CHECK (min_order >= 0),
  conditions       TEXT,
  home_delivery    BOOLEAN NOT NULL DEFAULT TRUE,
  pickup_available BOOLEAN NOT NULL DEFAULT FALSE,
  pickup_address   TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_zones_uq ON delivery_zones(seller_id, region_id, COALESCE(commune, ''));

CREATE SEQUENCE IF NOT EXISTS order_number_seq;

CREATE TABLE IF NOT EXISTS orders (
  id              SERIAL PRIMARY KEY,
  order_no        TEXT NOT NULL UNIQUE,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  seller_id       INTEGER NOT NULL REFERENCES sellers(id),
  status          TEXT NOT NULL DEFAULT 'nouvelle' CHECK (status IN
    ('en_attente_paiement','nouvelle','en_attente_confirmation','confirmee','en_preparation','prete','en_livraison','livree','annulee')),
  payment_method  TEXT NOT NULL DEFAULT 'pi' CHECK (payment_method IN ('pi')),
  payment_status  TEXT NOT NULL DEFAULT 'non_paye' CHECK (payment_status IN ('non_paye','en_cours','paye','echoue','rembourse')),
  -- Instantané du client et de l'adresse au moment de la commande
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,
  customer_email  TEXT,
  pi_username     TEXT,
  region_id       INTEGER NOT NULL REFERENCES regions(id),
  department      TEXT NOT NULL,
  commune         TEXT NOT NULL,
  quartier        TEXT NOT NULL,
  address_line    TEXT NOT NULL,
  landmark        TEXT,
  lat             NUMERIC(9,6),
  lng             NUMERIC(9,6),
  delivery_mode   TEXT NOT NULL CHECK (delivery_mode IN ('domicile','professionnelle','retrait_vente','retrait_relais')),
  comment         TEXT,
  subtotal        NUMERIC(14,7) NOT NULL CHECK (subtotal >= 0),
  delivery_fee    NUMERIC(14,7) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  total           NUMERIC(14,7) NOT NULL CHECK (total >= 0),
  final_total     NUMERIC(14,7) CHECK (final_total IS NULL OR final_total >= 0),  -- après pesée
  reject_reason   TEXT,
  consent_data    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_seller_idx ON orders(seller_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id           SERIAL PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,            -- instantané
  unit         TEXT NOT NULL,            -- instantané
  unit_price   NUMERIC(14,7) NOT NULL,         -- prix appliqué au moment de la commande
  quantity     NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
  line_total   NUMERIC(14,7) NOT NULL,
  image_url    TEXT
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  note       TEXT,
  changed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deliveries (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL,
  zone_id       INTEGER REFERENCES delivery_zones(id) ON DELETE SET NULL,
  fee           NUMERIC(14,7) NOT NULL DEFAULT 0,
  eta_text      TEXT,
  driver_name   TEXT,
  driver_phone  TEXT,
  delivered_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payments (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id),
  method      TEXT NOT NULL CHECK (method IN ('pi')),
  amount_pi   NUMERIC(14,7) NOT NULL,
  status      TEXT NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente','en_cours','paye','echoue','rembourse')),
  confirmed_by INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments(order_id);

CREATE TABLE IF NOT EXISTS pi_transactions (
  id            SERIAL PRIMARY KEY,
  payment_id    INTEGER NOT NULL REFERENCES payments(id),
  pi_payment_id TEXT NOT NULL UNIQUE,
  pi_uid        TEXT,
  txid          TEXT,
  amount_pi     NUMERIC(20,7),
  status        TEXT NOT NULL DEFAULT 'cree',  -- cree, approuve, complete, annule
  raw           JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  order_id   INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS complaints (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  order_id   INTEGER REFERENCES orders(id),
  subject    TEXT NOT NULL,
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'ouverte' CHECK (status IN ('ouverte','en_cours','resolue','rejetee')),
  response   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  details    JSONB,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Supabase: accès via la clé de service côté serveur uniquement (RLS sans politique).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE (
      SELECT string_agg(format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tablename), '; ')
      FROM pg_tables WHERE schemaname = 'public'
    );
  END IF;
END $$;

-- Évolutions (idempotentes)
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;

-- Recherche insensible aux accents/casse (sans extension)
CREATE OR REPLACE FUNCTION unaccent_lite(t text) RETURNS text AS $$
  SELECT translate(lower(t), 'àâäáãéèêëíîïìóôöòõúùûüçñœ', 'aaaaaeeeeiiiiooooouuuucno')
$$ LANGUAGE sql IMMUTABLE;
