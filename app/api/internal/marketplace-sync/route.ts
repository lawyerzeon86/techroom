import { NextResponse } from 'next/server';
import { timingSafeEqual, createHash } from 'node:crypto';
import { ensureSchema, getPool } from '../../../../lib/db';
import { getWarehouseSettings } from '../../../../lib/marketplace-settings';
import { pushPricesAndStocks } from '../../../../lib/auto-sync';
import { syncMarketplace, type MarketplaceName } from '../../../../lib/marketplaces';
import { listCommunications, type CommunicationType } from '../../../../lib/communications';
import { importMarketplaceProducts, runAutoProductTransfers, syncHubCatalogToSite } from '../../../../lib/product-hub';
import { refreshSiteCatalogFacts } from '../../../../lib/site-catalog-refresh';
import { runPriceGuard } from '../../../../lib/price-guard';
import { verifyGitHubActionsToken } from '../../../../lib/github-oidc';

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
      new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label}_TIMEOUT_${timeoutMs}MS`)),timeoutMs);})
    ]);
  }finally{if(timer)clearTimeout(timer)}
}

async function safeStage<T>(label:string,timeoutMs:number,fn:()=>Promise<T>):Promise<T|{error:string}>{
  try{return await withTimeout(label,timeoutMs,fn)}catch(e:any){return {error:String(e?.message||e)}}
}

async function saveCommunications(source:MarketplaceName,kind:CommunicationType){
  let data;
  try{data=await listCommunications(source,kind)}catch(error:any){
    const message=String(error?.message||error);
    if(source!=='wildberries'||!/(429|rate.?limit|too many)/i.test(message))throw error;
    const retrySeconds=Math.max(1,Number(message.match(/(?:retry|повтор)[^\d]*(\d+)/i)?.[1]||10));
    if(retrySeconds>30)throw error;
    await new Promise(resolve=>setTimeout(resolve,retrySeconds*1000));
    data=await listCommunications(source,kind);
  }
  const pool=getPool();
  for(const item of data.items||[]){
    await pool.query(`INSERT INTO marketplace_communications
      (source,kind,external_id,product_name,sku,article,rating,text,answer,external_created_at,raw_payload,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW())
      ON CONFLICT(source,kind,external_id) DO UPDATE SET product_name=EXCLUDED.product_name,sku=EXCLUDED.sku,article=EXCLUDED.article,
      rating=EXCLUDED.rating,text=EXCLUDED.text,answer=EXCLUDED.answer,external_created_at=EXCLUDED.external_created_at,
      raw_payload=EXCLUDED.raw_payload,synced_at=NOW()`,[source,kind,String(item.id),item.productName||null,item.sku||null,item.article||null,item.rating==null?null:Number(item.rating),item.text||null,typeof item.answer==='string'?item.answer:(item.answer?JSON.stringify(item.answer):null),item.createdAt||null,JSON.stringify(item.raw||{})]);
  }
  await pool.query("CREATE TABLE IF NOT EXISTS marketplace_settings (key TEXT PRIMARY KEY,value TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("INSERT INTO marketplace_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()",['wb_last_'+kind,new Date().toISOString()]);
  return Number(data.total||data.items?.length||0);
}

async function syncMarketplaceBundle(source:MarketplaceName,includeCommunications:boolean){
  const result:any={};
  result.orders=await safeStage(`${source.toUpperCase()}_ORDERS`,20000,()=>syncMarketplace(source));
  if(!includeCommunications){
    result.reviews={skipped:'scheduled_separately'};
    result.questions={skipped:'scheduled_separately'};
    return result;
  }
  if(source==='ozon'){
    result.reviews={skipped:'requires_premium_plus'};
    result.questions={skipped:'requires_premium_plus'};
    return result;
  }
  const settings=await getPool().query("SELECT key,value FROM marketplace_settings WHERE key IN ('wb_last_reviews','wb_last_questions')");
  const last=new Map(settings.rows.map((r:any)=>[r.key,Date.parse(r.value)||0]));
  const kind:CommunicationType=Number(last.get('wb_last_reviews')||0)<=Number(last.get('wb_last_questions')||0)?'reviews':'questions';
  result[kind==='reviews'?'questions':'reviews']={skipped:'next_communication_cycle'};
  result[kind]=await safeStage(`${source.toUpperCase()}_${kind.toUpperCase()}`,60000,()=>saveCommunications(source,kind));
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
  const bearer=request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]||'';
  const cronAuthorized=Boolean(configured&&provided&&safeEqual(configured,provided));
  const githubAuthorized=bearer?await verifyGitHubActionsToken(bearer).catch(()=>false):false;
  if(!cronAuthorized&&!githubAuthorized)return NextResponse.json({error:'Unauthorized'},{status:401});

  const lock=await getPool().connect();
  const acquired=(await lock.query('SELECT pg_try_advisory_lock(74195022) AS acquired')).rows[0].acquired;
  if(!acquired){lock.release();return NextResponse.json({ok:true,skipped:true,reason:'sync_in_progress'},{status:202})}
  try{
    await ensureSchema();
    const pool=getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_sync_runs (id BIGSERIAL PRIMARY KEY,started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),finished_at TIMESTAMPTZ,ok BOOLEAN,result JSONB NOT NULL DEFAULT '{}'::jsonb,error TEXT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_communications (id BIGSERIAL PRIMARY KEY,source TEXT NOT NULL,kind TEXT NOT NULL,external_id TEXT NOT NULL,product_name TEXT,sku TEXT,article TEXT,rating INTEGER,text TEXT,answer TEXT,external_created_at TIMESTAMPTZ,raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(source,kind,external_id))`);

    const url=new URL(request.url);
    const force=cronAuthorized&&url.searchParams.get('force')==='1';
    const includeCommunications=cronAuthorized&&url.searchParams.get('communications')==='1';
    const includeTransfers=cronAuthorized&&url.searchParams.get('transfers')==='1';
    const last=await pool.query(`SELECT started_at FROM marketplace_sync_runs ORDER BY id DESC LIMIT 1`);
    const lastAt=last.rows[0]?.started_at?new Date(last.rows[0].started_at).getTime():0;
    if(!force&&lastAt&&Date.now()-lastAt<10*60*1000)return NextResponse.json({ok:true,skipped:true,reason:'recent_sync'},{status:202});

    const run=await pool.query(`INSERT INTO marketplace_sync_runs DEFAULT VALUES RETURNING id`);
    const runId=Number(run.rows[0].id);
    const result:any={ok:true,runId,forced:force,communications:includeCommunications,transfers:includeTransfers,stages:{},productHub:{imports:{},site:null,facts:null,prune:null,transfer:null}};

    if(includeCommunications){
      result.stages.wildberries=process.env.WB_API_TOKEN?.trim()?await syncMarketplaceBundle('wildberries',true):{skipped:'not_configured'};
      result.stages.ozon={reviews:{skipped:'requires_premium_plus'},questions:{skipped:'requires_premium_plus'}};
      const errors=collectErrors(result);if(errors.length){result.partial=true;result.partialErrors=errors}
      await pool.query('UPDATE marketplace_sync_runs SET finished_at=NOW(),ok=$2,result=$3::jsonb WHERE id=$1',[runId,!errors.length,JSON.stringify(result)]);
      return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
    }

    const warehouses:any=await safeStage('WAREHOUSE_SETTINGS',15000,()=>getWarehouseSettings());
    result.stages.warehouses=warehouses;
    if(!warehouses?.error&&warehouses.ozonWarehouseId)process.env.OZON_WAREHOUSE_ID=warehouses.ozonWarehouseId;

    const [wb,ozon]=await Promise.all([
      process.env.WB_API_TOKEN?.trim()?syncMarketplaceBundle('wildberries',includeCommunications):Promise.resolve({skipped:'not_configured'}),
      process.env.OZON_CLIENT_ID?.trim()&&process.env.OZON_API_KEY?.trim()?syncMarketplaceBundle('ozon',includeCommunications):Promise.resolve({skipped:'not_configured'})
    ]);
    result.stages.wildberries=wb;
    result.stages.ozon=ozon;

    result.stages.catalog=await safeStage('CATALOG_SYNC',120000,()=>pushPricesAndStocks());
    result.stages.priceGuard=await safeStage('PRICE_GUARD',120000,()=>runPriceGuard());

    if(process.env.WB_API_TOKEN?.trim())await new Promise(resolve=>setTimeout(resolve,10000));
    const importStartedAt=new Date();
    const wbImport:any=process.env.WB_API_TOKEN?.trim()?await safeStage('WB_PRODUCT_IMPORT',60000,()=>importMarketplaceProducts('wb',100)):{skipped:'not_configured'};
    const ozonImport:any=process.env.OZON_CLIENT_ID?.trim()&&process.env.OZON_API_KEY?.trim()?await safeStage('OZON_PRODUCT_IMPORT',60000,()=>importMarketplaceProducts('ozon',100)):{skipped:'not_configured'};
    result.productHub.imports.wb=wbImport;
    result.productHub.imports.ozon=ozonImport;

    result.productHub.site=await safeStage('SITE_CATALOG_SYNC',30000,()=>syncHubCatalogToSite());

    const bothImportsSucceeded=Number.isFinite(Number(wbImport?.imported))&&Number.isFinite(Number(ozonImport?.imported))&&!wbImport?.error&&!ozonImport?.error;
    if(bothImportsSucceeded){
      const fresh=await pool.query(`UPDATE products p SET is_active=TRUE,updated_at=NOW()
        WHERE p.marketplace_source IN ('wb','ozon') AND EXISTS(
          SELECT 1 FROM marketplace_product_hub h JOIN marketplace_product_links l ON l.hub_id=h.id
          WHERE h.canonical_sku=p.sku AND l.marketplace IN ('wb','ozon') AND l.last_status='source' AND l.last_synced_at >= $1
        )`,[importStartedAt]);
      const stale=await pool.query(`UPDATE products p SET is_active=FALSE,updated_at=NOW()
        WHERE p.marketplace_source IN ('wb','ozon') AND NOT EXISTS(
          SELECT 1 FROM marketplace_product_hub h JOIN marketplace_product_links l ON l.hub_id=h.id
          WHERE h.canonical_sku=p.sku AND l.marketplace IN ('wb','ozon') AND l.last_status='source' AND l.last_synced_at >= $1
        )`,[importStartedAt]);
      result.productHub.prune={fresh:Number(fresh.rowCount||0),deactivated:Number(stale.rowCount||0)};
    }else{
      result.productHub.prune={skipped:'imports_incomplete'};
    }

    result.productHub.facts=await safeStage('SITE_CATALOG_FACTS',90000,()=>refreshSiteCatalogFacts());
    result.productHub.transfer=includeTransfers
      ? await safeStage('AUTO_PRODUCT_TRANSFER',120000,()=>runAutoProductTransfers())
      : {skipped:'scheduled_separately'};

    const partialErrors=collectErrors(result);
    if(partialErrors.length){result.partial=true;result.partialErrors=partialErrors}
    await pool.query(`UPDATE marketplace_sync_runs SET finished_at=NOW(),ok=$3,result=$2::jsonb WHERE id=$1`,[runId,JSON.stringify(result),!partialErrors.length]);
    return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch(error:any){
    return NextResponse.json({error:String(error?.message||'Sync failed')},{status:500});
  }finally{await lock.query('SELECT pg_advisory_unlock(74195022)').catch(()=>{});lock.release()}
}
