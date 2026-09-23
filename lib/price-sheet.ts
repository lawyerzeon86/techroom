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
      cost_price INTEGER NOT NULL DEFAULT 0,
      tax_rate NUMERIC(6,3) NOT NULL DEFAULT 0,
      variable_cost INTEGER NOT NULL DEFAULT 0,
      sync_ozon BOOLEAN NOT NULL DEFAULT TRUE,
      sync_wb BOOLEAN NOT NULL DEFAULT TRUE,
      sync_yandex BOOLEAN NOT NULL DEFAULT TRUE,
      sync_avito BOOLEAN NOT NULL DEFAULT TRUE,
      avito_item_id BIGINT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE price_sheet ADD COLUMN IF NOT EXISTS sync_ozon BOOLEAN NOT NULL DEFAULT TRUE`);
  await pool.query(`ALTER TABLE price_sheet ADD COLUMN IF NOT EXISTS sync_wb BOOLEAN NOT NULL DEFAULT TRUE`);
  await pool.query(`ALTER TABLE price_sheet ADD COLUMN IF NOT EXISTS sync_yandex BOOLEAN NOT NULL DEFAULT TRUE`);
  await pool.query(`ALTER TABLE price_sheet ADD COLUMN IF NOT EXISTS sync_avito BOOLEAN NOT NULL DEFAULT TRUE`);
  await pool.query(`ALTER TABLE price_sheet ADD COLUMN IF NOT EXISTS avito_item_id BIGINT`);
  await pool.query(`ALTER TABLE price_sheet ADD COLUMN IF NOT EXISTS min_price INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE price_sheet ADD COLUMN IF NOT EXISTS cost_price INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE price_sheet ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(6,3) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE price_sheet ADD COLUMN IF NOT EXISTS variable_cost INTEGER NOT NULL DEFAULT 0`);
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
    SELECT ps.sku,ps.product_id,ps.title,ps.price,ps.min_price,ps.cost_price,ps.tax_rate,ps.variable_cost,ps.sync_ozon,ps.sync_wb,ps.sync_yandex,ps.sync_avito,ps.avito_item_id,ps.updated_at,
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
    costPrice:Number(r.cost_price)||0,
    taxRate:Number(r.tax_rate)||0,
    variableCost:Number(r.variable_cost)||0,
    stock:Number(r.stock)||0,
    syncOzon:Boolean(r.sync_ozon),
    syncWb:Boolean(r.sync_wb),
    syncYandex:Boolean(r.sync_yandex),
    syncAvito:Boolean(r.sync_avito),
    avitoItemId:r.avito_item_id==null?null:Number(r.avito_item_id),
    updatedAt:r.updated_at,
  }));
}

function percent(value:any){
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||n>100)throw new Error('VALIDATION');
  return Math.round(n*1000)/1000;
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
      const costPrice=intPrice(raw?.costPrice??0);
      const taxRate=percent(raw?.taxRate??0);
      const variableCost=intPrice(raw?.variableCost??0);
      const syncOzon=raw?.syncOzon!==false;
      const syncWb=raw?.syncWb!==false;
      const syncYandex=raw?.syncYandex!==false;
      const syncAvito=raw?.syncAvito!==false;
      const avitoItemId=raw?.avitoItemId===null||raw?.avitoItemId===''||raw?.avitoItemId===undefined?null:Number(raw.avitoItemId);
      if(avitoItemId!==null&&(!Number.isSafeInteger(avitoItemId)||avitoItemId<=0))throw new Error('VALIDATION');
      const updated=await client.query(`
        UPDATE price_sheet SET price=$2,min_price=$3,cost_price=$4,tax_rate=$5,variable_cost=$6,sync_ozon=$7,sync_wb=$8,sync_yandex=$9,sync_avito=$10,avito_item_id=$11,updated_at=NOW()
        WHERE sku=$1
        RETURNING product_id
      `,[sku,price,minPrice,costPrice,taxRate,variableCost,syncOzon,syncWb,syncYandex,syncAvito,avitoItemId]);
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
    avito:Boolean(process.env.AVITO_CLIENT_ID?.trim()&&process.env.AVITO_CLIENT_SECRET?.trim()),
  };
}

export function hardFloorForSku(sku:string){return DEFAULT_FLOORS[sku]||0}


export async function syncPriceSheetFromWildberries(products:Array<{sku?:string;offerId?:string;title?:string;price?:number}>){
  await ensurePriceSheetSchema();
  const pool=getPool();
  let matched=0,updated=0,skipped=0;
  for(const p of products){
    const sku=String(p.offerId||p.sku||'').trim();
    const wbPrice=Math.round(Number(p.price)||0);
    if(!sku||wbPrice<=0){skipped++;continue}
    const row=await pool.query(`SELECT min_price FROM price_sheet WHERE sku=$1`,[sku]);
    if(!row.rows[0]){skipped++;continue}
    matched++;
    const minPrice=Math.max(Number(row.rows[0].min_price)||0,hardFloorForSku(sku));
    const price=Math.max(wbPrice,minPrice);
    await pool.query(`UPDATE price_sheet SET price=$2,updated_at=NOW() WHERE sku=$1`,[sku,price]);
    await pool.query(`UPDATE products SET price=$2,updated_at=NOW() WHERE sku=$1`,[sku,price]);
    updated++;
  }
  return {matched,updated,skipped};
}

export async function setAvitoItemMappings(mappings:Array<{sku:string;itemId:number}>){
  await ensurePriceSheetSchema();
  const pool=getPool();
  let updated=0;
  for(const m of mappings){
    const sku=String(m.sku||'').trim();
    const itemId=Number(m.itemId);
    if(!sku||!Number.isSafeInteger(itemId)||itemId<=0)continue;
    const r=await pool.query(`UPDATE price_sheet SET avito_item_id=$2,updated_at=NOW() WHERE sku=$1`,[sku,itemId]);
    updated+=r.rowCount||0;
  }
  return {updated};
}
