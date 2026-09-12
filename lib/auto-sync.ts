import { ensureSchema, getPool } from './db';
import { syncMarketplace, type MarketplaceName } from './marketplaces';
import { listCommunications, type CommunicationType } from './communications';

async function ensureAutoSyncSchema(){
  await ensureSchema();
  const pool=getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketplace_communications (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      external_id TEXT NOT NULL,
      product_name TEXT,
      sku TEXT,
      article TEXT,
      rating INTEGER,
      text TEXT,
      answer TEXT,
      external_created_at TIMESTAMPTZ,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(source,kind,external_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketplace_sync_runs (
      id BIGSERIAL PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      ok BOOLEAN,
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      error TEXT
    )
  `);
}

async function saveCommunications(source:MarketplaceName,kind:CommunicationType){
  const data=await listCommunications(source,kind);
  const pool=getPool();
  for(const item of data.items||[]){
    await pool.query(`
      INSERT INTO marketplace_communications
        (source,kind,external_id,product_name,sku,article,rating,text,answer,external_created_at,raw_payload,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW())
      ON CONFLICT(source,kind,external_id) DO UPDATE SET
        product_name=EXCLUDED.product_name,
        sku=EXCLUDED.sku,
        article=EXCLUDED.article,
        rating=EXCLUDED.rating,
        text=EXCLUDED.text,
        answer=EXCLUDED.answer,
        external_created_at=EXCLUDED.external_created_at,
        raw_payload=EXCLUDED.raw_payload,
        synced_at=NOW()
    `,[
      source,kind,String(item.id),item.productName||null,item.sku||null,item.article||null,
      item.rating==null?null:Number(item.rating),item.text||null,
      typeof item.answer==='string'?item.answer:(item.answer?JSON.stringify(item.answer):null),
      item.createdAt||null,JSON.stringify(item.raw||{})
    ]);
  }
  return Number(data.total||data.items?.length||0);
}

async function pushPricesAndStocks(){
  const pool=getPool();
  const {rows}=await pool.query(`SELECT sku,price,stock FROM products WHERE is_active=TRUE AND sku IS NOT NULL AND sku<>'' ORDER BY id`);
  const products=rows.map((r:any)=>({sku:String(r.sku),price:Number(r.price)||0,stock:Number(r.stock)||0}));
  const result:any={products:products.length,wb:{prices:'skipped',stocks:'skipped'},ozon:{prices:'skipped',stocks:'skipped'}};

  if(process.env.WB_API_TOKEN?.trim() && products.length){
    try{
      const token=process.env.WB_API_TOKEN!.trim();
      const cardsRes=await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list',{
        method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},
        body:JSON.stringify({settings:{cursor:{limit:100},filter:{withPhoto:-1},sort:{ascending:false}}}),cache:'no-store'
      });
      const cardsJson=await cardsRes.json().catch(()=>({}));
      if(!cardsRes.ok) throw new Error(cardsJson?.message||`WB_CARDS_${cardsRes.status}`);
      const cards=Array.isArray(cardsJson?.cards)?cardsJson.cards:[];
      const local=new Map(products.map((p:any)=>[p.sku,p]));
      const prices:any[]=[];
      const stocks:any[]=[];
      for(const c of cards){
        const p=local.get(String(c.vendorCode||''));
        if(!p) continue;
        if(c.nmID) prices.push({nmID:Number(c.nmID),price:Math.max(1,Math.round(p.price)),discount:0});
        const sizes=Array.isArray(c.sizes)?c.sizes:[];
        for(const s of sizes){
          const skus=Array.isArray(s.skus)?s.skus:[];
          for(const barcode of skus) stocks.push({sku:String(barcode),amount:Math.max(0,Math.round(p.stock))});
        }
      }
      if(prices.length && process.env.SYNC_MARKETPLACE_PRICES==='1'){
        const r=await fetch('https://discounts-prices-api.wildberries.ru/api/v2/upload/task',{
          method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({data:prices}),cache:'no-store'
        });
        if(!r.ok) throw new Error(`WB_PRICE_${r.status}`);
        result.wb.prices=prices.length;
      }
      const warehouseId=process.env.WB_WAREHOUSE_ID?.trim();
      if(stocks.length && warehouseId && process.env.SYNC_MARKETPLACE_STOCKS==='1'){
        const r=await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(warehouseId)}`,{
          method:'PUT',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({stocks}),cache:'no-store'
        });
        if(!r.ok) throw new Error(`WB_STOCK_${r.status}`);
        result.wb.stocks=stocks.length;
      } else if(!warehouseId) result.wb.stocks='needs_WB_WAREHOUSE_ID';
    }catch(e:any){result.wb.error=String(e?.message||e)}
  }

  if(process.env.OZON_CLIENT_ID?.trim() && process.env.OZON_API_KEY?.trim() && products.length){
    try{
      const headers={'Client-Id':process.env.OZON_CLIENT_ID!.trim(),'Api-Key':process.env.OZON_API_KEY!.trim(),'Content-Type':'application/json'};
      if(process.env.SYNC_MARKETPLACE_PRICES==='1'){
        const prices=products.map((p:any)=>({offer_id:p.sku,price:String(Math.max(1,Math.round(p.price))),old_price:'0',premium_price:'0'}));
        const r=await fetch('https://api-seller.ozon.ru/v1/product/import/prices',{method:'POST',headers,body:JSON.stringify({prices}),cache:'no-store'});
        if(!r.ok) throw new Error(`OZON_PRICE_${r.status}`);
        result.ozon.prices=prices.length;
      }
      const warehouseId=process.env.OZON_WAREHOUSE_ID?.trim();
      if(warehouseId && process.env.SYNC_MARKETPLACE_STOCKS==='1'){
        const stocks=products.map((p:any)=>({offer_id:p.sku,stock:Math.max(0,Math.round(p.stock)),warehouse_id:Number(warehouseId)}));
        const r=await fetch('https://api-seller.ozon.ru/v2/products/stocks',{method:'POST',headers,body:JSON.stringify({stocks}),cache:'no-store'});
        if(!r.ok) throw new Error(`OZON_STOCK_${r.status}`);
        result.ozon.stocks=stocks.length;
      } else if(!warehouseId) result.ozon.stocks='needs_OZON_WAREHOUSE_ID';
    }catch(e:any){result.ozon.error=String(e?.message||e)}
  }
  return result;
}

export async function runAutomaticMarketplaceSync(){
  await ensureAutoSyncSchema();
  const pool=getPool();
  const run=await pool.query(`INSERT INTO marketplace_sync_runs DEFAULT VALUES RETURNING id`);
  const runId=run.rows[0].id;
  const result:any={orders:{},communications:{},catalog:{}};
  try{
    for(const mp of ['wildberries','ozon'] as MarketplaceName[]){
      try{result.orders[mp]=await syncMarketplace(mp)}catch(e:any){result.orders[mp]={error:String(e?.message||e)}}
      for(const kind of ['reviews','questions'] as CommunicationType[]){
        try{result.communications[`${mp}:${kind}`]=await saveCommunications(mp,kind)}catch(e:any){result.communications[`${mp}:${kind}`]={error:String(e?.message||e)}}
      }
    }
    result.catalog=await pushPricesAndStocks();
    await pool.query(`UPDATE marketplace_sync_runs SET finished_at=NOW(),ok=TRUE,result=$2::jsonb WHERE id=$1`,[runId,JSON.stringify(result)]);
    return {ok:true,runId:Number(runId),...result};
  }catch(error:any){
    await pool.query(`UPDATE marketplace_sync_runs SET finished_at=NOW(),ok=FALSE,error=$2 WHERE id=$1`,[runId,String(error?.message||error)]);
    throw error;
  }
}
