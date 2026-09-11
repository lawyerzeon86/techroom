import { Pool } from 'pg';
import { seedProducts } from './products';

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
          rating NUMERIC(2,1) NOT NULL DEFAULT 5.0,
          reviews INTEGER NOT NULL DEFAULT 0,
          badge TEXT,
          emoji TEXT,
          image_url TEXT,
          sku TEXT,
          oem TEXT,
          stock INTEGER NOT NULL DEFAULT 0,
          description TEXT,
          specs TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      const count = await pool.query('SELECT COUNT(*)::int AS count FROM products');
      if (count.rows[0].count === 0) {
        for (const p of seedProducts) {
          await pool.query(
            `INSERT INTO products (category,title,price,old_price,rating,reviews,badge,emoji,image_url,sku,oem,stock,description,specs,is_active,sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [p.category,p.title,p.price,p.oldPrice,p.rating,p.reviews,p.badge,p.emoji,p.imageUrl,p.sku,p.oem,p.stock,p.description,p.specs,p.isActive,p.sortOrder]
          );
        }
      }
    })().catch(err => { globalForDb.schemaReady = undefined; throw err; });
  }
  await globalForDb.schemaReady;
}

export function rowToProduct(row: any) {
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
    imageUrl: row.image_url,
    sku: row.sku,
    oem: row.oem,
    stock: Number(row.stock),
    description: row.description,
    specs: row.specs,
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order),
  };
}
