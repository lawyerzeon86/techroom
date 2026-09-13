import { ensureSchema, getPool } from './db';
import { getProducts, updateProductText, type MarketplaceUi } from './marketplace-content';

export type HubMarketplace = MarketplaceUi;

export async function ensureProductHubSchema(){
  await ensureSchema();
  const pool=getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketplace_product_hub (
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
    )
  `);
  await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_product_links (id BIGSERIAL PRIMARY KEY,hub_id BIGINT NOT NULL REFERENCES marketplace_product_hub(id) ON DELETE CASCADE,marketplace TEXT NOT NULL,product_id TEXT,offer_id TEXT,sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,last_status TEXT NOT NULL DEFAULT 'linked',last_error TEXT,last_synced_at TIMESTAMPTZ,UNIQUE(hub_id, marketplace))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_product_rules (id BIGSERIAL PRIMARY KEY,source_marketplace TEXT NOT NULL,target_marketplace TEXT NOT NULL,enabled BOOLEAN NOT NULL DEFAULT TRUE,auto_publish BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(source_marketplace,target_marketplace))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_product_jobs (id BIGSERIAL PRIMARY KEY,hub_id BIGINT NOT NULL REFERENCES marketplace_product_hub(id) ON DELETE CASCADE,target_marketplace TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',message TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS marketplace_source TEXT`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS marketplace_product_id TEXT`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS marketplace_payload JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_marketplace_source ON products(marketplace_source)`);
}

function canonicalSku(p:any){return String(p.offerId||p.sku||p.id||'').trim()}
function categoryFrom(h:any){
  const text=`${h.title||''} ${h.description||''} ${JSON.stringify(h.attributes||{})}`.toLowerCase();
  if(/audi|bmw|mercedes|porsche|авто|порог|датчик|кожух|запчаст/.test(text))return 'Автозапчасти';
  if(/3d|печать|printed|asa|abs|petg|pla|нейлон/.test(text))return '3D-печать';
  if(/электрон|кабель|заряд|адаптер|usb|науш/.test(text))return 'Электроника';
  return 'Гаджеты';
}
function specsFrom(h:any){
  const lines:string[]=[];const a=h.attributes||{};
  for(const [k,v] of Object.entries(a).slice(0,80)){const value=Array.isArray(v)?v.join(', '):String(v??'');if(value)lines.push(`${k}: ${value}`)}
  const d=h.dimensions||{};
  if(d.length||d.width||d.height)lines.push(`Упаковка: ${d.length||0} × ${d.width||0} × ${d.height||0} ${d.dimensionUnit||''}`.trim());
  if(d.weight)lines.push(`Вес с упаковкой: ${d.weight} ${d.weightUnit||''}`.trim());
  return lines.join('\n').slice(0,10000);
}

export async function importMarketplaceProducts(mp:HubMarketplace,limit=100){
  await ensureProductHubSchema();
  const pool=getPool();
  const products=await getProducts(mp,'',Math.max(1,Math.min(100,limit)));
  let imported=0;
  for(const p of products){
    const sku=canonicalSku(p);if(!sku)continue;
    const result=await pool.query(`INSERT INTO marketplace_product_hub(canonical_sku,title,description,dimensions,images,attributes,source_marketplace,source_product_id,source_offer_id,source_payload,source_updated_at,updated_at) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10::jsonb,NOW(),NOW()) ON CONFLICT(canonical_sku) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,dimensions=EXCLUDED.dimensions,images=CASE WHEN jsonb_array_length(EXCLUDED.images)>0 THEN EXCLUDED.images ELSE marketplace_product_hub.images END,attributes=CASE WHEN EXCLUDED.attributes<>'{}'::jsonb THEN EXCLUDED.attributes ELSE marketplace_product_hub.attributes END,source_marketplace=EXCLUDED.source_marketplace,source_product_id=EXCLUDED.source_product_id,source_offer_id=EXCLUDED.source_offer_id,source_payload=EXCLUDED.source_payload,source_updated_at=NOW(),updated_at=NOW() RETURNING id`,[sku,p.title||'',p.description||'',JSON.stringify(p.dimensions||{}),JSON.stringify(p.images||[]),JSON.stringify(p.attributes||{}),mp,String(p.id||''),String(p.offerId||''),JSON.stringify(p)]);
    const hubId=result.rows[0].id;
    await pool.query(`INSERT INTO marketplace_product_links(hub_id,marketplace,product_id,offer_id,sync_enabled,last_status,last_synced_at) VALUES($1,$2,$3,$4,TRUE,'source',NOW()) ON CONFLICT(hub_id,marketplace) DO UPDATE SET product_id=EXCLUDED.product_id,offer_id=EXCLUDED.offer_id,last_status='source',last_synced_at=NOW(),last_error=NULL`,[hubId,mp,String(p.id||''),String(p.offerId||'')]);
    imported++;
  }
  return {imported};
}

export async function syncHubCatalogToSite(){
  await ensureProductHubSchema();
  const pool=getPool();
  const {rows}=await pool.query(`SELECT * FROM marketplace_product_hub ORDER BY updated_at DESC LIMIT 5000`);
  let created=0,updated=0;
  for(const h of rows){
    const payload=h.source_payload||{};
    const images=Array.isArray(h.images)?h.images.filter((x:any)=>typeof x==='string'&&x):[];
    const price=Math.max(0,Math.round(Number(payload?.price||0)||0));
    const existing=await pool.query(`SELECT id,price,stock,image_urls FROM products WHERE sku=$1 ORDER BY id LIMIT 1`,[h.canonical_sku]);
    const category=categoryFrom(h);const specs=specsFrom(h);const mainImage=images[0]||null;
    if(existing.rows[0]){
      await pool.query(`UPDATE products SET category=$2,title=COALESCE(NULLIF($3,''),title),price=CASE WHEN $4>0 THEN $4 ELSE price END,image_url=CASE WHEN $5 IS NOT NULL THEN $5 ELSE image_url END,image_urls=CASE WHEN jsonb_array_length($6::jsonb)>0 THEN $6::jsonb ELSE image_urls END,description=CASE WHEN $7<>'' THEN $7 ELSE description END,specs=CASE WHEN $8<>'' THEN $8 ELSE specs END,marketplace_source=$9,marketplace_product_id=$10,marketplace_payload=$11::jsonb,updated_at=NOW() WHERE id=$1`,[existing.rows[0].id,category,h.title||'',price,mainImage,JSON.stringify(images),h.description||'',specs,h.source_marketplace,h.source_product_id,JSON.stringify(payload)]);updated++;
    }else{
      await pool.query(`INSERT INTO products(category,title,price,old_price,rating,reviews,badge,emoji,image_url,image_urls,sku,oem,stock,description,specs,is_active,sort_order,marketplace_source,marketplace_product_id,marketplace_payload) VALUES($1,$2,$3,NULL,5,0,$4,'📦',$5,$6::jsonb,$7,NULL,0,$8,$9,TRUE,1000,$10,$11,$12::jsonb)`,[category,h.title||h.canonical_sku,price,'Маркетплейс',mainImage,JSON.stringify(images),h.canonical_sku,h.description||'',specs,h.source_marketplace,h.source_product_id,JSON.stringify(payload)]);created++;
    }
  }
  return {processed:rows.length,created,updated};
}

async function findTargetBySku(mp:HubMarketplace,sku:string){const products=await getProducts(mp,sku,50);return products.find((p:any)=>canonicalSku(p)===sku)||null}
async function queueMapping(pool:any,hubId:number,target:HubMarketplace){
  const exists=await pool.query(`SELECT id FROM marketplace_product_jobs WHERE hub_id=$1 AND target_marketplace=$2 AND status IN ('needs_mapping','manual_review','auto_mapped') ORDER BY id DESC LIMIT 1`,[hubId,target]);
  if(!exists.rows[0])await pool.query(`INSERT INTO marketplace_product_jobs(hub_id,target_marketplace,status,message) VALUES($1,$2,'needs_mapping',$3)`,[hubId,target,'Нужно сопоставить категорию и обязательные характеристики для создания новой карточки']);
  await pool.query(`INSERT INTO marketplace_product_links(hub_id,marketplace,sync_enabled,last_status,last_error) VALUES($1,$2,TRUE,'needs_mapping',$3) ON CONFLICT(hub_id,marketplace) DO UPDATE SET last_status='needs_mapping',last_error=EXCLUDED.last_error`,[hubId,target,'Карточка с таким SKU на площадке не найдена']);
}
export async function syncHubProductToTarget(hubId:number,target:HubMarketplace){
  await ensureProductHubSchema();const pool=getPool();const {rows}=await pool.query(`SELECT * FROM marketplace_product_hub WHERE id=$1`,[hubId]);const hub=rows[0];
  if(!hub)throw new Error('HUB_PRODUCT_NOT_FOUND');if(hub.source_marketplace===target)return {status:'skipped',reason:'source_marketplace'};
  const targetProduct=await findTargetBySku(target,String(hub.canonical_sku));
  if(!targetProduct){await queueMapping(pool,hubId,target);return {status:'needs_mapping'}}
  try{
    await updateProductText(target,{id:String(targetProduct.id||''),offerId:String(targetProduct.offerId||hub.canonical_sku),title:target==='wb'?String(hub.title||''):undefined,description:String(hub.description||''),dimensions:hub.dimensions||{}} as any);
    await pool.query(`INSERT INTO marketplace_product_links(hub_id,marketplace,product_id,offer_id,sync_enabled,last_status,last_error,last_synced_at) VALUES($1,$2,$3,$4,TRUE,'synced',NULL,NOW()) ON CONFLICT(hub_id,marketplace) DO UPDATE SET product_id=EXCLUDED.product_id,offer_id=EXCLUDED.offer_id,last_status='synced',last_error=NULL,last_synced_at=NOW()`,[hubId,target,String(targetProduct.id||''),String(targetProduct.offerId||hub.canonical_sku)]);return {status:'synced'};
  }catch(e:any){await pool.query(`INSERT INTO marketplace_product_links(hub_id,marketplace,sync_enabled,last_status,last_error) VALUES($1,$2,TRUE,'error',$3) ON CONFLICT(hub_id,marketplace) DO UPDATE SET last_status='error',last_error=EXCLUDED.last_error`,[hubId,target,String(e?.message||e)]);throw e}
}
export async function runAutoProductTransfers(){
  await ensureProductHubSchema();const pool=getPool();const rules=await pool.query(`SELECT * FROM marketplace_product_rules WHERE enabled=TRUE AND auto_publish=TRUE ORDER BY id`);const result:any[]=[];
  for(const rule of rules.rows){const products=await pool.query(`SELECT id FROM marketplace_product_hub WHERE source_marketplace=$1 ORDER BY updated_at DESC LIMIT 500`,[rule.source_marketplace]);for(const p of products.rows){try{result.push({hubId:Number(p.id),target:rule.target_marketplace,...await syncHubProductToTarget(Number(p.id),rule.target_marketplace)})}catch(e:any){result.push({hubId:Number(p.id),target:rule.target_marketplace,status:'error',error:String(e?.message||e)})}}}
  return {processed:result.length,results:result};
}
export async function listHubProducts(){
  await ensureProductHubSchema();const pool=getPool();const {rows}=await pool.query(`SELECT h.*,COALESCE(json_agg(json_build_object('marketplace',l.marketplace,'productId',l.product_id,'offerId',l.offer_id,'status',l.last_status,'error',l.last_error,'lastSyncedAt',l.last_synced_at)) FILTER (WHERE l.id IS NOT NULL),'[]'::json) links FROM marketplace_product_hub h LEFT JOIN marketplace_product_links l ON l.hub_id=h.id GROUP BY h.id ORDER BY h.updated_at DESC LIMIT 1000`);
  return rows.map((r:any)=>({id:Number(r.id),sku:r.canonical_sku,title:r.title,description:r.description,dimensions:r.dimensions||{},images:r.images||[],attributes:r.attributes||{},sourceMarketplace:r.source_marketplace,sourceProductId:r.source_product_id,sourceOfferId:r.source_offer_id,updatedAt:r.updated_at,links:r.links||[]}));
}
export async function saveTransferRule(source:HubMarketplace,target:HubMarketplace,enabled=true,autoPublish=true){await ensureProductHubSchema();if(source===target)throw new Error('SOURCE_EQUALS_TARGET');const pool=getPool();await pool.query(`INSERT INTO marketplace_product_rules(source_marketplace,target_marketplace,enabled,auto_publish) VALUES($1,$2,$3,$4) ON CONFLICT(source_marketplace,target_marketplace) DO UPDATE SET enabled=EXCLUDED.enabled,auto_publish=EXCLUDED.auto_publish`,[source,target,enabled,autoPublish]);return {ok:true}}
export async function listTransferRules(){await ensureProductHubSchema();const pool=getPool();const {rows}=await pool.query(`SELECT source_marketplace source,target_marketplace target,enabled,auto_publish "autoPublish" FROM marketplace_product_rules ORDER BY id`);return rows}
