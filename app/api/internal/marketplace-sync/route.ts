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
    const warehouseSettings=await getWarehouseSettings();
    if(warehouseSettings.wbWarehouseId) process.env.WB_WAREHOUSE_ID=warehouseSettings.wbWarehouseId;
    if(warehouseSettings.ozonWarehouseId) process.env.OZON_WAREHOUSE_ID=warehouseSettings.ozonWarehouseId;
    const result:any=await runAutomaticMarketplaceSync();
    result.productHub={imports:{},site:null,transfer:null};
    if(process.env.WB_API_TOKEN?.trim()){
      try{result.productHub.imports.wb=await importMarketplaceProducts('wb',100)}catch(e:any){result.productHub.imports.wb={error:String(e?.message||e)}}
    }
    if(process.env.OZON_CLIENT_ID?.trim()&&process.env.OZON_API_KEY?.trim()){
      try{result.productHub.imports.ozon=await importMarketplaceProducts('ozon',100)}catch(e:any){result.productHub.imports.ozon={error:String(e?.message||e)}}
    }
    try{result.productHub.site=await syncHubCatalogToSite()}catch(e:any){result.productHub.site={error:String(e?.message||e)}}
    try{result.productHub.transfer=await runAutoProductTransfers()}catch(e:any){result.productHub.transfer={error:String(e?.message||e)}}
    return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch(error:any){
    return NextResponse.json({error:String(error?.message||'Sync failed')},{status:500});
  }
}
