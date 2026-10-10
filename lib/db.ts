import { Pool } from 'pg';

const globalForDb = globalThis as unknown as { techroomPool?: Pool; schemaReady?: Promise<void> };

export function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  if (!globalForDb.techroomPool) {
    globalForDb.techroomPool = new Pool({
      connectionString,
      ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalForDb.techroomPool;
}

export async function ensureSchema() {
  if (!globalForDb.schemaReady) {
    globalForDb.schemaReady = (async () => {
      const pool = getPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          price INTEGER NOT NULL DEFAULT 0,
          old_price INTEGER,
          rating NUMERIC(2,1) NOT NULL DEFAULT 0,
          reviews INTEGER NOT NULL DEFAULT 0,
          badge TEXT,
          emoji TEXT,
          image_url TEXT,
          image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
          sku TEXT,
          oem TEXT,
          stock INTEGER NOT NULL DEFAULT 0,
          description TEXT,
          specs TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS marketplace_source TEXT`);
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS marketplace_product_id TEXT`);
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS marketplace_payload JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS description_override TEXT`);
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS specs_override TEXT`);
      await pool.query(`CREATE TABLE IF NOT EXISTS telegram_outbox (
        id BIGSERIAL PRIMARY KEY, payload JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0, lease_until TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sent_at TIMESTAMPTZ
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS email_outbox (
        id BIGSERIAL PRIMARY KEY, order_number TEXT UNIQUE NOT NULL, payload JSONB NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, last_attempt_at TIMESTAMPTZ, last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sent_at TIMESTAMPTZ
      )`);
      await pool.query(`UPDATE products SET image_urls=jsonb_build_array(image_url) WHERE image_url IS NOT NULL AND image_url<>'' AND jsonb_array_length(image_urls)=0`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id BIGSERIAL PRIMARY KEY,
          order_number TEXT UNIQUE NOT NULL,
          customer_name TEXT NOT NULL,
          phone TEXT NOT NULL,
          email TEXT,
          delivery_method TEXT NOT NULL,
          address TEXT,
          payment_method TEXT NOT NULL,
          comment TEXT,
          total_amount INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'new',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS order_items (
          id BIGSERIAL PRIMARY KEY,
          order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL REFERENCES products(id),
          title TEXT NOT NULL,
          sku TEXT,
          price INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          line_total INTEGER NOT NULL
        )
      `);

      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS telegram_username TEXT`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS max_user_id BIGINT`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS max_username TEXT`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider TEXT`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id TEXT`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_url TEXT`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_token TEXT`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_error TEXT`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_updated_at TIMESTAMPTZ`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency_code CHAR(3) NOT NULL DEFAULT 'RUB'`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS marketplace_orders (
          id BIGSERIAL PRIMARY KEY,
          source TEXT NOT NULL,
          external_id TEXT NOT NULL,
          order_number TEXT,
          status TEXT NOT NULL,
          total_amount INTEGER NOT NULL DEFAULT 0,
          customer_name TEXT,
          phone TEXT,
          items JSONB NOT NULL DEFAULT '[]'::jsonb,
          raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          external_created_at TIMESTAMPTZ,
          synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(source, external_id)
        )
      `);

      await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketplace_orders_source ON marketplace_orders(source, synced_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketplace_orders_created ON marketplace_orders(external_created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_telegram_user ON orders(telegram_user_id, created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_max_user ON orders(max_user_id, created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_whatsapp_phone ON orders(whatsapp_phone, created_at DESC)`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_id ON orders(payment_id) WHERE payment_id IS NOT NULL`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_token ON orders(payment_token) WHERE payment_token IS NOT NULL`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_marketplace_source ON products(marketplace_source)`);
    })().catch(err => { globalForDb.schemaReady = undefined; throw err; });
  }
  await globalForDb.schemaReady;
}

export function rowToProduct(row: any) {
  const imageUrls = Array.isArray(row.image_urls) ? row.image_urls.filter((v:any)=>typeof v === 'string') : [];
  const imageUrl = row.image_url || imageUrls[0] || null;
  return {
    id: Number(row.id),
    category: row.category,
    title: row.title,
    price: Number(row.price),
    oldPrice: row.old_price == null ? null : Number(row.old_price),
    rating: Number(row.rating),
    reviews: Number(row.reviews),
    badge: row.badge,
    emoji: row.emoji,
    imageUrl,
    imageUrls: imageUrls.length ? imageUrls : (imageUrl ? [imageUrl] : []),
    sku: row.sku,
    oem: row.oem,
    stock: Number(row.stock),
    description: row.description,
    specs: row.specs,
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order),
  };
}
