import { NextResponse } from 'next/server';
import { timingSafeEqual, createHash } from 'node:crypto';
import { ensureSchema, getPool } from '../../../../lib/db';
import { getWarehouseSettings } from '../../../../lib/marketplace-settings';
import { pushPricesAndStocks } from '../../../../lib/auto-sync';
import { syncMarketplace, type MarketplaceName } from '../../../../lib/marketplaces';
import { listCommunications, type CommunicationType } from '../../../../lib/communications';
import { importMarketplaceProducts, runAutoProductTransfers, syncHubCatalogToSite } from '../../../../lib/product-hub';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function safeEqual(a:string,b:string){
  const ah=createHash('sha256').update(a).digest();
  const bh=createHash('sha256').update(b).digest();
  return timingSafeEqual(ah,bh);
}

async function withTimeout<T>(label:string,timeoutMs:number,fn:()=>Promise<T>):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    return await Promise.race([
      fn(),
      new Promise<T>((_,reject)=>{
        timer=setTimeout(()=>reject(new Error(`${label}_TIMEOUT_${timeoutMs}MS`)),timeoutMs);
      })
    ]);
  }finally{
    if(timer)clearTimeout(timer);
  }
}

async function safeStage<T>(label:string,timeoutMs:number,fn:()=>Promise<T>):Promise<T|{error:string}>{
  try{return await withTimeout(label,timeoutMs,fn)}
  catch(e:any){return {error:String(e?.message||e)}}
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

async function syncMarketplaceBundle(source:MarketplaceName){
  const result:any={};
  result.orders=await safeStage(`${source.toUpperCase()}_ORDERS`,20000,()=>syncMarketplace(source));
  result.reviews=await safeStage(`${source.toUpperCase()}_REVIEWS`,20000,()=>saveCommunications(source,'reviews'));
  result.questions=await safeStage(`${source.toUpperCase()}_QUESTIONS`,20000,()=>saveCommunications(source,'questions'));
  return result;
}

function collectErrors(value:any,path='result',out:string[]=[]){
  if(!value||typeof value!=='object')return out;
  if(typeof value.error==='string')out.push(`${path}: ${value.error}`);
  for(const [key,child] of Object.entries(value)){
    if(key==='error')continue;
    if(child&&typeof child==='object')collectErrors(child,`${path}.${key}`,out);
  }
  return out;
}

export async function POST(request:Request){
  const configured=process.env.CRON_SYNC_SECRET?.trim();
  const provided=request.headers.get('x-cron-secret')?.trim()||'';
  if(configured && (!provided||!safeEqual(configured,provided))){
    return NextResponse.json({error:'Unauthorized'},{status:401});
  }

  try{
    await ensureSchema();
    const pool=getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_sync_runs (id BIGSERIAL PRIMARY KEY,started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),finished_at TIMESTAMPTZ,ok BOOLEAN,result JSONB NOT NULL DEFAULT '{}'::jsonb,error TEXT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_communications (id BIGSERIAL PRIMARY KEY,source TEXT NOT NULL,kind TEXT NOT NULL,external_id TEXT NOT NULL,product_name TEXT,sku TEXT,article TEXT,rating INTEGER,text TEXT,answer TEXT,external_created_at TIMESTAMPTZ,raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(source,kind,external_id))`);

    const last=await pool.query(`SELECT started_at FROM marketplace_sync_runs ORDER BY id DESC LIMIT 1`);
    const lastAt=last.rows[0]?.started_at?new Date(last.rows[0].started_at).getTime():0;
    if(lastAt && Date.now()-lastAt<10*60*1000){
      return NextResponse.json({ok:true,skipped:true,reason:'recent_sync'},{status:202});
    }

    const run=await pool.query(`INSERT INTO marketplace_sync_runs DEFAULT VALUES RETURNING id`);
    const runId=Number(run.rows[0].id);
    const result:any={ok:true,runId,stages:{},productHub:{imports:{},site:null,transfer:null}};

    const warehouses:any=await safeStage('WAREHOUSE_SETTINGS',15000,()=>getWarehouseSettings());
    result.stages.warehouses=warehouses;
    if(!warehouses?.error){
      if(warehouses.wbWarehouseId)process.env.WB_WAREHOUSE_ID=warehouses.wbWarehouseId;
      if(warehouses.ozonWarehouseId)process.env.OZON_WAREHOUSE_ID=warehouses.ozonWarehouseId;
    }

    const [wb,ozon]=await Promise.all([
      process.env.WB_API_TOKEN?.trim()?syncMarketplaceBundle('wildberries'):Promise.resolve({skipped:'not_configured'}),
      process.env.OZON_CLIENT_ID?.trim()&&process.env.OZON_API_KEY?.trim()?syncMarketplaceBundle('ozon'):Promise.resolve({skipped:'not_configured'})
    ]);
    result.stages.wildberries=wb;
    result.stages.ozon=ozon;

    result.stages.catalog=await safeStage('CATALOG_SYNC',45000,()=>pushPricesAndStocks());

    const [wbImport,ozonImport]=await Promise.all([
      process.env.WB_API_TOKEN?.trim()?safeStage('WB_PRODUCT_IMPORT',30000,()=>importMarketplaceProducts('wb',100)):Promise.resolve({skipped:'not_configured'}),
      process.env.OZON_CLIENT_ID?.trim()&&process.env.OZON_API_KEY?.trim()?safeStage('OZON_PRODUCT_IMPORT',30000,()=>importMarketplaceProducts('ozon',100)):Promise.resolve({skipped:'not_configured'})
    ]);
    result.productHub.imports.wb=wbImport;
    result.productHub.imports.ozon=ozonImport;

    result.productHub.site=await safeStage('SITE_CATALOG_SYNC',30000,()=>syncHubCatalogToSite());
    result.productHub.transfer=await safeStage('AUTO_PRODUCT_TRANSFER',20000,()=>runAutoProductTransfers());

    const partialErrors=collectErrors(result);
    if(partialErrors.length){
      result.partial=true;
      result.partialErrors=partialErrors;
    }

    await pool.query(`UPDATE marketplace_sync_runs SET finished_at=NOW(),ok=TRUE,result=$2::jsonb WHERE id=$1`,[runId,JSON.stringify(result)]);
    return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch(error:any){
    return NextResponse.json({error:String(error?.message||'Sync failed')},{status:500});
  }
}
