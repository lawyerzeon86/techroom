import { ensureSchema, getPool } from './db';
import { syncMarketplace, type MarketplaceName } from './marketplaces';
import { listCommunications, type CommunicationType } from './communications';
import { importMarketplaceProducts, runAutoProductTransfers } from './product-hub';
import { hardFloorForSku, listPriceSheet } from './price-sheet';
import { pushAvitoPrices } from './avito';

function targetPrice(p:{sku:string;price:number;minPrice:number}){
  return Math.max(1,Math.round(p.price),Math.round(p.minPrice||0),hardFloorForSku(p.sku));
}

const OZON_AUTO_FLOOR=2990;
const OZON_AUTO_PATTERN=/(audi|bmw|mercedes|porsche|авто|автомоб|порог|наклад|датчик|кожух|запчаст|fender|8w0821653|a4\s*b9|a4\s*b8)/i;
function ozonAutoFloor(p:{sku:string;title?:string}){return OZON_AUTO_PATTERN.test(`${p.title||''} ${p.sku||''}`)?OZON_AUTO_FLOOR:0}

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
    `,[source,kind,String(item.id),item.productName||null,item.sku||null,item.article||null,item.rating==null?null:Number(item.rating),item.text||null,typeof item.answer==='string'?item.answer:(item.answer?JSON.stringify(item.answer):null),item.createdAt||null,JSON.stringify(item.raw||{})]);
  }
  return Number(data.total||data.items?.length||0);
}

export async function pushPricesAndStocks(options:{onlyOzonPrices?:boolean;onlyPrices?:boolean}={}){
  const pool=getPool();
  const products=await listPriceSheet();
  const result:any={products:products.length,wb:{prices:'skipped',stocks:'skipped'},ozon:{prices:'skipped',stocks:'skipped'},yandex:{prices:'skipped'},avito:{prices:'skipped'}};

  if(!options.onlyOzonPrices && process.env.WB_API_TOKEN?.trim() && products.length){
    try{
      const token=process.env.WB_API_TOKEN!.trim();
      const cardsRes=await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list',{method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({settings:{cursor:{limit:100},filter:{withPhoto:-1},sort:{ascending:false}}}),cache:'no-store'});
      const cardsJson=await cardsRes.json().catch(()=>({}));
      if(!cardsRes.ok) throw new Error(cardsJson?.message||`WB_CARDS_${cardsRes.status}`);
      const cards=Array.isArray(cardsJson?.cards)?cardsJson.cards:[];
      const local=new Map(products.filter((p:any)=>p.syncWb).map((p:any)=>[p.sku,p]));
      const prices:any[]=[];const stocks:any[]=[];
      for(const c of cards){
        const p=local.get(String(c.vendorCode||''));if(!p) continue;
        if(c.nmID) prices.push({nmID:Number(c.nmID),price:targetPrice(p),discount:0});
        for(const s of Array.isArray(c.sizes)?c.sizes:[]) for(const barcode of Array.isArray(s.skus)?s.skus:[]) stocks.push({sku:String(barcode),amount:Math.max(0,Math.round(p.stock))});
      }
      if(prices.length && (process.env.SYNC_WB_PRICES==='1'||process.env.SYNC_MARKETPLACE_PRICES==='1')){
        const r=await fetch('https://discounts-prices-api.wildberries.ru/api/v2/upload/task',{method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({data:prices}),cache:'no-store'});
        if(r.status===429){
          result.wb.prices={status:'rate_limited',retryAfter:r.headers.get('x-ratelimit-retry')||r.headers.get('retry-after')||null};
        }else if(!r.ok){
          throw new Error(`WB_PRICE_${r.status}`);
        }else result.wb.prices=prices.length;
      }
      const warehouseId=process.env.WB_WAREHOUSE_ID?.trim();
      if(!options.onlyPrices && stocks.length && warehouseId && process.env.SYNC_MARKETPLACE_STOCKS==='1'){
        const r=await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(warehouseId)}`,{method:'PUT',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({stocks}),cache:'no-store'});
        if(!r.ok) throw new Error(`WB_STOCK_${r.status}`);result.wb.stocks=stocks.length;
      } else if(!warehouseId) result.wb.stocks='needs_WB_WAREHOUSE_ID';
    }catch(e:any){result.wb.error=String(e?.message||e)}
  }

  if(process.env.OZON_CLIENT_ID?.trim() && process.env.OZON_API_KEY?.trim() && products.length){
    try{
      const headers={'Client-Id':process.env.OZON_CLIENT_ID!.trim(),'Api-Key':process.env.OZON_API_KEY!.trim(),'Content-Type':'application/json'};
      if(process.env.SYNC_OZON_PRICES==='1'||process.env.SYNC_MARKETPLACE_PRICES==='1'){
        const ozonProducts=products.filter((p:any)=>p.syncOzon&&p.price>0);
        const currentRes=ozonProducts.length?await fetch('https://api-seller.ozon.ru/v3/product/info/list',{method:'POST',headers,body:JSON.stringify({offer_id:ozonProducts.map((p:any)=>p.sku),product_id:[],sku:[]}),cache:'no-store'}):null;
        const currentJson=currentRes?await currentRes.json().catch(()=>({})):{};
        if(currentRes&&!currentRes.ok)throw new Error(`OZON_PRICE_INFO_${currentRes.status}`);
        const currentItems=Array.isArray(currentJson?.items)?currentJson.items:(Array.isArray(currentJson?.result?.items)?currentJson.result.items:[]);
        const currentByOffer=new Map(currentItems.map((item:any)=>[String(item.offer_id||''),{price:Number(item.price||0),minPrice:Number(item.min_price||0)}]));
        const prices=ozonProducts
          .map((p:any)=>{
            const current:any=currentByOffer.get(p.sku)||{price:0,minPrice:0};
            const target=Math.max(targetPrice(p),ozonAutoFloor(p),Math.round(current.minPrice||0));
            return {offer_id:p.sku,target,current:Number(current.price||0),minPrice:Number(current.minPrice||0)};
          })
          .filter((p:any)=>p.target>0&&p.current>0&&Math.round(p.current)!==p.target)
          .map((p:any)=>({offer_id:p.offer_id,price:String(p.target),min_price:String(Math.max(p.minPrice||0,ozonAutoFloor({sku:p.offer_id}))),old_price:'0',premium_price:'0',auto_action_enabled:'DISABLED'}));
        if(prices.length){
          const r=await fetch('https://api-seller.ozon.ru/v1/product/import/prices',{method:'POST',headers,body:JSON.stringify({prices}),cache:'no-store'});
          const data=await r.json().catch(()=>({}));
          if(!r.ok) throw new Error(String(data?.message||`OZON_PRICE_${r.status}`));
          const errors=(Array.isArray(data?.result)?data.result:[]).flatMap((x:any)=>(Array.isArray(x?.errors)?x.errors:[]).map((e:any)=>({offerId:x.offer_id,code:e?.code,message:e?.message})));
          result.ozon.prices={requested:prices.length,updated:(Array.isArray(data?.result)?data.result.filter((x:any)=>x?.updated===true).length:prices.length),errors};
        }else result.ozon.prices={requested:0,updated:0,errors:[]};
      }
      const warehouseId=process.env.OZON_WAREHOUSE_ID?.trim();
      if(!options.onlyOzonPrices && !options.onlyPrices && warehouseId && process.env.SYNC_MARKETPLACE_STOCKS==='1'){
        const stocks=products.map((p:any)=>({offer_id:p.sku,stock:Math.max(0,Math.round(p.stock)),warehouse_id:Number(warehouseId)}));
        const r=await fetch('https://api-seller.ozon.ru/v2/products/stocks',{method:'POST',headers,body:JSON.stringify({stocks}),cache:'no-store'});
        if(!r.ok) throw new Error(`OZON_STOCK_${r.status}`);result.ozon.stocks=stocks.length;
      } else if(!options.onlyOzonPrices && !options.onlyPrices && !warehouseId) result.ozon.stocks='needs_OZON_WAREHOUSE_ID';
    }catch(e:any){result.ozon.error=String(e?.message||e)}
  }
  if(!options.onlyOzonPrices && process.env.YANDEX_MARKET_API_KEY?.trim() && process.env.YANDEX_MARKET_BUSINESS_ID?.trim() && products.length && (process.env.SYNC_YANDEX_PRICES==='1'||process.env.SYNC_MARKETPLACE_PRICES==='1')){
    try{
      const apiKey=process.env.YANDEX_MARKET_API_KEY!.trim();
      const businessId=process.env.YANDEX_MARKET_BUSINESS_ID!.trim();
      const yandexProducts=products.filter((p:any)=>p.syncYandex&&p.price>0);
      let pushed=0;
      for(let i=0;i<yandexProducts.length;i+=2000){
        const part=yandexProducts.slice(i,i+2000);
        const offers=part.map((p:any)=>({offerId:p.sku,price:{value:targetPrice(p),currencyId:'RUR'}}));
        if(!offers.length)continue;
        const res=await fetch(`https://api.partner.market.yandex.ru/v2/businesses/${encodeURIComponent(businessId)}/offer-prices/updates`,{
          method:'POST',headers:{'Api-Key':apiKey,'Content-Type':'application/json'},body:JSON.stringify({offers}),cache:'no-store'
        });
        const data=await res.json().catch(()=>({}));
        if(!res.ok)throw new Error(String(data?.message||data?.errors?.[0]?.message||`YANDEX_PRICE_${res.status}`));
        pushed+=offers.length;
      }
      result.yandex.prices=pushed;
    }catch(e:any){result.yandex.error=String(e?.message||e)}
  }

  if(!options.onlyOzonPrices){
    try{result.avito.prices=await pushAvitoPrices()}catch(e:any){result.avito.error=String(e?.message||e)}
  }

  return result;
}

export async function runAutomaticMarketplaceSync(){
  await ensureAutoSyncSchema();
  const pool=getPool();
  const run=await pool.query(`INSERT INTO marketplace_sync_runs DEFAULT VALUES RETURNING id`);
  const runId=run.rows[0].id;
  const result:any={orders:{},communications:{},catalog:{},productHub:{imports:{},transfer:null}};
  try{
    for(const mp of ['wildberries','ozon'] as MarketplaceName[]){
      try{result.orders[mp]=await syncMarketplace(mp)}catch(e:any){result.orders[mp]={error:String(e?.message||e)}}
      for(const kind of ['reviews','questions'] as CommunicationType[]){
        try{result.communications[`${mp}:${kind}`]=await saveCommunications(mp,kind)}catch(e:any){result.communications[`${mp}:${kind}`]={error:String(e?.message||e)}}
      }
    }
    result.catalog=await pushPricesAndStocks();
    if(process.env.WB_API_TOKEN?.trim()){
      try{result.productHub.imports.wb=await importMarketplaceProducts('wb',100)}catch(e:any){result.productHub.imports.wb={error:String(e?.message||e)}}
    }
    if(process.env.OZON_CLIENT_ID?.trim()&&process.env.OZON_API_KEY?.trim()){
      try{result.productHub.imports.ozon=await importMarketplaceProducts('ozon',100)}catch(e:any){result.productHub.imports.ozon={error:String(e?.message||e)}}
    }
    try{result.productHub.transfer=await runAutoProductTransfers()}catch(e:any){result.productHub.transfer={error:String(e?.message||e)}}
    await pool.query(`UPDATE marketplace_sync_runs SET finished_at=NOW(),ok=TRUE,result=$2::jsonb WHERE id=$1`,[runId,JSON.stringify(result)]);
    return {ok:true,runId:Number(runId),...result};
  }catch(error:any){
    await pool.query(`UPDATE marketplace_sync_runs SET finished_at=NOW(),ok=FALSE,error=$2 WHERE id=$1`,[runId,String(error?.message||error)]);
    throw error;
  }
}


export async function pushStockForSku(sku:string,stock:number,warehouses?:{wbWarehouseId?:string|null;ozonWarehouseId?:string|null}){
  const amount=Math.max(0,Math.round(stock));
  const result:any={sku,stock:amount,wb:{status:'skipped'},ozon:{status:'skipped'}};

  if(process.env.WB_API_TOKEN?.trim()&&warehouses?.wbWarehouseId){
    try{
      const token=process.env.WB_API_TOKEN.trim();
      const cardsRes=await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list',{
        method:'POST',
        headers:{Authorization:token,'Content-Type':'application/json'},
        body:JSON.stringify({settings:{cursor:{limit:100},filter:{textSearch:sku,withPhoto:-1},sort:{ascending:false}}}),
        cache:'no-store'
      });
      const cardsJson=await cardsRes.json().catch(()=>({}));
      if(!cardsRes.ok)throw new Error(String(cardsJson?.message||`WB_CARDS_${cardsRes.status}`));
      const card=(Array.isArray(cardsJson?.cards)?cardsJson.cards:[]).find((x:any)=>String(x?.vendorCode||'')===sku);
      if(!card)throw new Error('WB_CARD_NOT_FOUND');
      const barcodes:string[]=[];
      for(const s of Array.isArray(card?.sizes)?card.sizes:[])for(const b of Array.isArray(s?.skus)?s.skus:[])if(b)barcodes.push(String(b));
      if(!barcodes.length)throw new Error('WB_BARCODE_NOT_FOUND');
      const stocks=barcodes.map(b=>({sku:b,amount}));
      const rr=await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(String(warehouses.wbWarehouseId))}`,{
        method:'PUT',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({stocks}),cache:'no-store'
      });
      const data=await rr.json().catch(()=>({}));
      if(!rr.ok)throw new Error(String(data?.message||data?.error||`WB_STOCK_${rr.status}`));
      result.wb={status:'updated',warehouseId:String(warehouses.wbWarehouseId),barcodes:barcodes.length};
    }catch(e:any){result.wb={status:'error',error:String(e?.message||e)}}
  } else if(!warehouses?.wbWarehouseId) result.wb={status:'missing_warehouse'};

  if(process.env.OZON_CLIENT_ID?.trim()&&process.env.OZON_API_KEY?.trim()&&warehouses?.ozonWarehouseId){
    try{
      const headers={'Client-Id':process.env.OZON_CLIENT_ID.trim(),'Api-Key':process.env.OZON_API_KEY.trim(),'Content-Type':'application/json'};
      const stocks=[{offer_id:sku,stock:amount,warehouse_id:Number(warehouses.ozonWarehouseId)}];
      const rr=await fetch('https://api-seller.ozon.ru/v2/products/stocks',{method:'POST',headers,body:JSON.stringify({stocks}),cache:'no-store'});
      const data=await rr.json().catch(()=>({}));
      if(!rr.ok)throw new Error(String(data?.message||data?.error||`OZON_STOCK_${rr.status}`));
      const errors=(Array.isArray(data?.result)?data.result:[]).flatMap((x:any)=>(Array.isArray(x?.errors)?x.errors:[]));
      if(errors.length)throw new Error('OZON_STOCK_'+JSON.stringify(errors).slice(0,2000));
      result.ozon={status:'updated',warehouseId:String(warehouses.ozonWarehouseId)};
    }catch(e:any){result.ozon={status:'error',error:String(e?.message||e)}}
  } else if(!warehouses?.ozonWarehouseId) result.ozon={status:'missing_warehouse'};

  return result;
}
