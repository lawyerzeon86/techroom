import { NextResponse } from 'next/server';
import { timingSafeEqual, createHash } from 'node:crypto';
import { ensureSchema, getPool } from '../../../../lib/db';
import { getWarehouseSettings } from '../../../../lib/marketplace-settings';
import { runAutomaticMarketplaceSync } from '../../../../lib/auto-sync';
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
    const last=await pool.query(`SELECT started_at FROM marketplace_sync_runs ORDER BY id DESC LIMIT 1`);
    const lastAt=last.rows[0]?.started_at?new Date(last.rows[0].started_at).getTime():0;
    if(lastAt && Date.now()-lastAt<10*60*1000){
      return NextResponse.json({ok:true,skipped:true,reason:'recent_sync'},{status:202});
    }

    const warehouseSettings=await withTimeout('WAREHOUSE_SETTINGS',15000,()=>getWarehouseSettings());
    if(warehouseSettings.wbWarehouseId) process.env.WB_WAREHOUSE_ID=warehouseSettings.wbWarehouseId;
    if(warehouseSettings.ozonWarehouseId) process.env.OZON_WAREHOUSE_ID=warehouseSettings.ozonWarehouseId;

    const main=await safeStage('AUTOMATIC_SYNC',150000,()=>runAutomaticMarketplaceSync());
    const result:any=(main&&typeof main==='object')?main:{ok:true};
    if('error' in result && Object.keys(result).length===1){
      result.ok=true;
      result.partial=true;
      result.syncError=result.error;
      delete result.error;
    }

    result.productHub={imports:{},site:null,transfer:null};
    if(process.env.WB_API_TOKEN?.trim()){
      result.productHub.imports.wb=await safeStage('WB_PRODUCT_IMPORT',45000,()=>importMarketplaceProducts('wb',100));
    }
    if(process.env.OZON_CLIENT_ID?.trim()&&process.env.OZON_API_KEY?.trim()){
      result.productHub.imports.ozon=await safeStage('OZON_PRODUCT_IMPORT',45000,()=>importMarketplaceProducts('ozon',100));
    }
    result.productHub.site=await safeStage('SITE_CATALOG_SYNC',45000,()=>syncHubCatalogToSite());
    result.productHub.transfer=await safeStage('AUTO_PRODUCT_TRANSFER',45000,()=>runAutoProductTransfers());

    const partialErrors=[
      result.syncError,
      result.productHub.imports.wb?.error,
      result.productHub.imports.ozon?.error,
      result.productHub.site?.error,
      result.productHub.transfer?.error,
    ].filter(Boolean);
    if(partialErrors.length){result.ok=true;result.partial=true;result.partialErrors=partialErrors;}

    return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch(error:any){
    return NextResponse.json({error:String(error?.message||'Sync failed')},{status:500});
  }
}
