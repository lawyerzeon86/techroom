import pg from 'pg';

const token=(process.env.WB_API_TOKEN||'').trim();
const warehouseId=(process.env.WB_WAREHOUSE_ID||'604848').trim();
const targets=new Set(['1344233224','1344806387','1363287832']);
if(!token)throw new Error('WB_API_TOKEN is not configured');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is not configured');

const pool=new pg.Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false},
  max:1
});

function cardKey(card){
  const nm=String(card?.nmID??card?.id??card?.marketplace_product_id??'');
  const vendor=String(card?.vendorCode??card?.offerId??card?.sku??'').trim();
  return targets.has(nm)?nm:(targets.has(vendor)?vendor:null);
}
function cardSkus(card){
  const raw=card?.raw||card?.marketplace_payload?.raw||card?.source_payload?.raw||card;
  const out=[];
  for(const size of Array.isArray(raw?.sizes)?raw.sizes:[]){
    for(const sku of Array.isArray(size?.skus)?size.skus:[])if(sku)out.push(String(sku));
  }
  return [...new Set(out)];
}

const found=new Map();
try{
  const cached=await pool.query('SELECT cards FROM wb_catalog_cache ORDER BY fetched_at DESC NULLS LAST LIMIT 1').catch(()=>({rows:[]}));
  for(const card of Array.isArray(cached.rows?.[0]?.cards)?cached.rows[0].cards:[]){
    const key=cardKey(card); if(!key)continue;
    const skus=cardSkus(card);
    if(skus.length)found.set(key,{nmID:String(card?.nmID||''),vendorCode:String(card?.vendorCode||''),skus});
  }

  if(found.size<targets.size){
    const rows=await pool.query(`SELECT marketplace_product_id,sku,marketplace_payload
      FROM products
      WHERE marketplace_source='wb'
        AND (marketplace_product_id = ANY($1::text[]) OR sku = ANY($1::text[]))`,[[...targets]]);
    for(const row of rows.rows){
      const candidate={...row.marketplace_payload,id:row.marketplace_product_id,sku:row.sku};
      const key=cardKey(candidate); if(!key||found.has(key))continue;
      const skus=cardSkus(candidate);
      if(skus.length)found.set(key,{nmID:String(row.marketplace_product_id||''),vendorCode:String(row.sku||''),skus});
    }
  }

  if(found.size<targets.size){
    const rows=await pool.query(`SELECT source_product_id,source_offer_id,source_payload
      FROM marketplace_product_hub
      WHERE source_marketplace='wb'
        AND (source_product_id = ANY($1::text[]) OR source_offer_id = ANY($1::text[]))`,[[...targets]]).catch(()=>({rows:[]}));
    for(const row of rows.rows){
      const candidate={...row.source_payload,id:row.source_product_id,offerId:row.source_offer_id};
      const key=cardKey(candidate); if(!key||found.has(key))continue;
      const skus=cardSkus(candidate);
      if(skus.length)found.set(key,{nmID:String(row.source_product_id||''),vendorCode:String(row.source_offer_id||''),skus});
    }
  }
}finally{
  await pool.end();
}

const missing=[...targets].filter(x=>!found.has(x));
if(missing.length)throw new Error('WB target articles/barcodes not found in Duisun cache: '+missing.join(', '));

const stocks=[];
for(const [requested,card] of found){
  for(const sku of card.skus)stocks.push({sku,amount:10});
}
const put=await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(warehouseId)}`,{
  method:'PUT',
  headers:{Authorization:token,'Content-Type':'application/json'},
  body:JSON.stringify({stocks}),
  signal:AbortSignal.timeout(20000)
});
const responseText=await put.text().catch(()=>'');
if(!put.ok)throw new Error(`WB stock update ${put.status}: ${responseText.slice(0,500)}`);
console.log(JSON.stringify({ok:true,warehouseId,amount:10,updated:[...found.entries()].map(([requested,v])=>({requested,nmID:v.nmID,vendorCode:v.vendorCode,skus:v.skus}))},null,2));
