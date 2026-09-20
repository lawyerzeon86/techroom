import { ensureSchema, getPool } from './db';

const DEFAULT_FLOORS:Record<string,number>={
  R8W0821653:2990,
  '8W0821653':2990,
  DAK8T54A53A:2990,
  FenderAudiA4B8front:2990,
  DAK123456:5000,
  'DAK-VASE-SHELL-ASA-WH-001':5000,
};

export async function ensurePriceSheetSchema(){
  await ensureSchema();
  const pool=getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS price_sheet (
      sku TEXT PRIMARY KEY,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      min_price INTEGER NOT NULL DEFAULT 0,
      sync_ozon BOOLEAN NOT NULL DEFAULT TRUE,
      sync_wb BOOLEAN NOT NULL DEFAULT TRUE,
      sync_yandex BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE price_sheet ADD COLUMN IF NOT EXISTS sync_ozon BOOLEAN NOT NULL DEFAULT TRUE`);
  await pool.query(`ALTER TABLE price_sheet ADD COLUMN IF NOT EXISTS sync_wb BOOLEAN NOT NULL DEFAULT TRUE`);
  await pool.query(`ALTER TABLE price_sheet ADD COLUMN IF NOT EXISTS sync_yandex BOOLEAN NOT NULL DEFAULT TRUE`);
  await pool.query(`ALTER TABLE price_sheet ADD COLUMN IF NOT EXISTS min_price INTEGER NOT NULL DEFAULT 0`);
  const seed=await pool.query(`
    SELECT DISTINCT ON (sku) id,sku,title,price
    FROM products
    WHERE sku IS NOT NULL AND BTRIM(sku)<>''
    ORDER BY sku,id
  `);
  for(const p of seed.rows){
    const sku=String(p.sku).trim();
    const floor=DEFAULT_FLOORS[sku]||0;
    const price=Math.max(Number(p.price)||0,floor);
    await pool.query(`
      INSERT INTO price_sheet(sku,product_id,title,price,min_price,updated_at)
      VALUES($1,$2,$3,$4,$5,NOW())
      ON CONFLICT(sku) DO UPDATE SET
        product_id=EXCLUDED.product_id,
        title=CASE WHEN EXCLUDED.title<>'' THEN EXCLUDED.title ELSE price_sheet.title END
    `,[sku,Number(p.id),String(p.title||''),price,floor]);
  }
}

export async function listPriceSheet(){
  await ensurePriceSheetSchema();
  const pool=getPool();
  const {rows}=await pool.query(`
    SELECT ps.sku,ps.product_id,ps.title,ps.price,ps.min_price,ps.sync_ozon,ps.sync_wb,ps.sync_yandex,ps.updated_at,
           COALESCE(p.stock,0) AS stock
    FROM price_sheet ps
    LEFT JOIN products p ON p.id=ps.product_id
    ORDER BY ps.title,ps.sku
  `);
  return rows.map((r:any)=>({
    sku:String(r.sku),
    productId:r.product_id==null?null:Number(r.product_id),
    title:String(r.title||''),
    price:Number(r.price)||0,
    minPrice:Number(r.min_price)||0,
    stock:Number(r.stock)||0,
    syncOzon:Boolean(r.sync_ozon),
    syncWb:Boolean(r.sync_wb),
    syncYandex:Boolean(r.sync_yandex),
    updatedAt:r.updated_at,
  }));
}

function intPrice(value:any){
  const n=Math.round(Number(value));
  if(!Number.isFinite(n)||n<0||n>100000000)throw new Error('VALIDATION');
  return n;
}

export async function savePriceSheet(items:any[]){
  if(!Array.isArray(items)||items.length<1||items.length>1000)throw new Error('VALIDATION');
  await ensurePriceSheetSchema();
  const pool=getPool();
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    for(const raw of items){
      const sku=String(raw?.sku||'').trim();
      if(!sku||sku.length>255)throw new Error('VALIDATION');
      const minPrice=intPrice(raw?.minPrice);
      const price=Math.max(intPrice(raw?.price),minPrice,DEFAULT_FLOORS[sku]||0);
      const syncOzon=raw?.syncOzon!==false;
      const syncWb=raw?.syncWb!==false;
      const syncYandex=raw?.syncYandex!==false;
      const updated=await client.query(`
        UPDATE price_sheet SET price=$2,min_price=$3,sync_ozon=$4,sync_wb=$5,sync_yandex=$6,updated_at=NOW()
        WHERE sku=$1
        RETURNING product_id
      `,[sku,price,minPrice,syncOzon,syncWb,syncYandex]);
      if(!updated.rows[0])throw new Error('SKU_NOT_FOUND');
      await client.query(`UPDATE products SET price=$2,updated_at=NOW() WHERE sku=$1`,[sku,price]);
    }
    await client.query('COMMIT');
  }catch(e){
    await client.query('ROLLBACK');
    throw e;
  }finally{client.release()}
  return listPriceSheet();
}

export function priceSheetMarketplaceStatus(){
  return {
    ozon:Boolean(process.env.OZON_CLIENT_ID?.trim()&&process.env.OZON_API_KEY?.trim()),
    wb:Boolean(process.env.WB_API_TOKEN?.trim()),
    yandex:Boolean(process.env.YANDEX_MARKET_API_KEY?.trim()&&process.env.YANDEX_MARKET_BUSINESS_ID?.trim()),
    avito:false,
  };
}

export function hardFloorForSku(sku:string){return DEFAULT_FLOORS[sku]||0}
