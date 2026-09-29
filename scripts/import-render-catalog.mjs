import fs from 'node:fs';
import pg from 'pg';

const { Client } = pg;

function loadEnvFile(path) {
  if (!fs.existsSync(path)) return;
  for (const raw of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile('/var/www/duisun/.env.production');

const sourceUrl = process.env.DUISUN_RENDER_CATALOG_URL || 'https://techroom-main.onrender.com/api/internal/migrate-catalog-20260929';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not configured');

const response = await fetch(sourceUrl, { cache: 'no-store', signal: AbortSignal.timeout(180000) });
if (!response.ok) throw new Error(`CATALOG_SOURCE_${response.status}`);
const payload = await response.json();
const incoming = Array.isArray(payload?.products)
  ? payload.products.filter((p) => ['wb', 'ozon'].includes(String(p?.marketplace_source || '')) && String(p?.sku || '').trim())
  : [];
if (!incoming.length) throw new Error('CATALOG_SOURCE_EMPTY');

const client = new Client({
  connectionString,
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
});
await client.connect();

try {
  await client.query('BEGIN');
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS marketplace_source TEXT`);
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS marketplace_product_id TEXT`);
  await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS marketplace_payload JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await client.query(`CREATE TABLE IF NOT EXISTS marketplace_product_hub (
    id BIGSERIAL PRIMARY KEY,
    canonical_sku TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
    images JSONB NOT NULL DEFAULT '[]'::jsonb,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_marketplace TEXT NOT NULL,
    source_product_id TEXT,
    source_offer_id TEXT,
    source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS marketplace_product_links (
    id BIGSERIAL PRIMARY KEY,
    hub_id BIGINT NOT NULL REFERENCES marketplace_product_hub(id) ON DELETE CASCADE,
    marketplace TEXT NOT NULL,
    product_id TEXT,
    offer_id TEXT,
    sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_status TEXT NOT NULL DEFAULT 'linked',
    last_error TEXT,
    last_synced_at TIMESTAMPTZ,
    UNIQUE(hub_id, marketplace)
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS marketplace_product_rules (
    id BIGSERIAL PRIMARY KEY,
    source_marketplace TEXT NOT NULL,
    target_marketplace TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    auto_publish BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source_marketplace,target_marketplace)
  )`);

  await client.query(`UPDATE products SET is_active=FALSE, updated_at=NOW() WHERE marketplace_source IN ('wb','ozon')`);

  let created = 0;
  let updated = 0;
  let totalStock = 0;
  for (const p of incoming) {
    const sku = String(p.sku).trim();
    const source = String(p.marketplace_source);
    const mp = p.marketplace_payload && typeof p.marketplace_payload === 'object' ? p.marketplace_payload : {};
    const images = Array.isArray(p.image_urls) ? p.image_urls.filter((x) => typeof x === 'string' && x) : [];
    const price = Math.max(0, Math.round(Number(p.price || 0)));
    const stock = Math.max(0, Math.round(Number(p.actual_stock || 0)));
    totalStock += stock;
    const existing = await client.query(`SELECT id FROM products WHERE sku=$1 ORDER BY id LIMIT 1`, [sku]);
    if (existing.rows[0]) {
      await client.query(`UPDATE products SET category=$2,title=$3,price=$4,old_price=NULL,rating=0,reviews=0,badge=NULL,emoji=NULL,
        image_url=$5,image_urls=$6::jsonb,stock=$7,description=$8,specs=$9,is_active=TRUE,sort_order=1000,
        marketplace_source=$10,marketplace_product_id=$11,marketplace_payload=$12::jsonb,updated_at=NOW() WHERE id=$1`, [
        existing.rows[0].id, String(p.category || 'Гаджеты'), String(p.title || sku), price,
        p.image_url || images[0] || null, JSON.stringify(images), stock, p.description || '', p.specs || '', source,
        p.marketplace_product_id ? String(p.marketplace_product_id) : String(mp.id || ''), JSON.stringify(mp),
      ]);
      updated++;
    } else {
      await client.query(`INSERT INTO products(category,title,price,old_price,rating,reviews,badge,emoji,image_url,image_urls,sku,oem,stock,description,specs,is_active,sort_order,marketplace_source,marketplace_product_id,marketplace_payload)
        VALUES($1,$2,$3,NULL,0,0,NULL,NULL,$4,$5::jsonb,$6,NULL,$7,$8,$9,TRUE,1000,$10,$11,$12::jsonb)`, [
        String(p.category || 'Гаджеты'), String(p.title || sku), price, p.image_url || images[0] || null,
        JSON.stringify(images), sku, stock, p.description || '', p.specs || '', source,
        p.marketplace_product_id ? String(p.marketplace_product_id) : String(mp.id || ''), JSON.stringify(mp),
      ]);
      created++;
    }

    const hub = await client.query(`INSERT INTO marketplace_product_hub(canonical_sku,title,description,dimensions,images,attributes,source_marketplace,source_product_id,source_offer_id,source_payload,source_updated_at,updated_at)
      VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10::jsonb,NOW(),NOW())
      ON CONFLICT(canonical_sku) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,dimensions=EXCLUDED.dimensions,
      images=EXCLUDED.images,attributes=EXCLUDED.attributes,source_marketplace=EXCLUDED.source_marketplace,
      source_product_id=EXCLUDED.source_product_id,source_offer_id=EXCLUDED.source_offer_id,source_payload=EXCLUDED.source_payload,
      source_updated_at=NOW(),updated_at=NOW() RETURNING id`, [
      sku, String(p.title || sku), String(p.description || ''), JSON.stringify(mp.dimensions || {}),
      JSON.stringify(Array.isArray(mp.images) ? mp.images : images), JSON.stringify(mp.attributes || {}), source,
      String(p.marketplace_product_id || mp.id || ''), String(mp.offerId || sku), JSON.stringify(mp),
    ]);
    const hubId = hub.rows[0].id;
    await client.query(`INSERT INTO marketplace_product_links(hub_id,marketplace,product_id,offer_id,sync_enabled,last_status,last_synced_at)
      VALUES($1,$2,$3,$4,TRUE,'source',NOW()) ON CONFLICT(hub_id,marketplace) DO UPDATE SET product_id=EXCLUDED.product_id,
      offer_id=EXCLUDED.offer_id,sync_enabled=TRUE,last_status='source',last_error=NULL,last_synced_at=NOW()`, [
      hubId, source, String(p.marketplace_product_id || mp.id || ''), String(mp.offerId || sku),
    ]);
  }

  await client.query(`INSERT INTO marketplace_product_rules(source_marketplace,target_marketplace,enabled,auto_publish)
    VALUES('wb','ozon',TRUE,TRUE) ON CONFLICT(source_marketplace,target_marketplace) DO UPDATE SET enabled=TRUE,auto_publish=TRUE`);
  await client.query(`INSERT INTO marketplace_product_rules(source_marketplace,target_marketplace,enabled,auto_publish)
    VALUES('ozon','wb',TRUE,TRUE) ON CONFLICT(source_marketplace,target_marketplace) DO UPDATE SET enabled=TRUE,auto_publish=TRUE`);

  await client.query('COMMIT');
  console.log(JSON.stringify({ ok: true, imported: incoming.length, created, updated, totalStock }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
