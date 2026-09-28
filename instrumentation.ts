import { runPriceGuard } from './lib/price-guard';
import { syncHubCatalogToSite } from './lib/product-hub';
import { pushPricesAndStocks, pushStockForSku, setAllOzonStock } from './lib/auto-sync';
import { syncTechRoomPricesFromWildberries } from './lib/wb-price-source';
import { publishSiteProductToMarketplaces } from './lib/site-product-publish';
import { getWarehouseSettings } from './lib/marketplace-settings';
import { ensureSchema, getPool } from './lib/db';

const g=globalThis as typeof globalThis & {
  __techroomPriceGuardTimer?:NodeJS.Timeout;
  __techroomPriceGuardBusy?:boolean;
  __techroomSiteSyncStarted?:boolean;
  __techroomOzonPriceSyncStarted?:boolean;
  __techroomWbPriceBootstrapStarted?:boolean;
  __techroomOzonStockTenStarted?:boolean;
  __techroomDskGothToyPublishStarted?:boolean;
  __techroomDskGothRingPublishStarted?:boolean;
  __techroomRingStockSyncStarted?:boolean;
  __techroomWbSellerStockClearStarted?:boolean;
};

async function priceGuardCycle(){
  if(g.__techroomPriceGuardBusy)return;
  g.__techroomPriceGuardBusy=true;
  try{
    const result=await runPriceGuard();
    console.log('[price-guard] completed',JSON.stringify(result));
  }catch(e:any){
    console.error('[price-guard]',String(e?.message||e));
  }finally{
    g.__techroomPriceGuardBusy=false;
  }
}

async function marketplacePriceSyncOnce(){
  try{
    const result=await pushPricesAndStocks({onlyPrices:true});
    console.log('[marketplace-price-sync] completed',JSON.stringify(result));
  }catch(e:any){
    console.error('[marketplace-price-sync]',String(e?.message||e));
  }
}

async function wbPriceBootstrapOnce(attempt=0){
  try{
    const result=await syncTechRoomPricesFromWildberries();
    console.log('[wb-site-price-sync] completed',JSON.stringify({...result,attempt}));
    if(result.updated===0&&attempt<2)setTimeout(()=>void wbPriceBootstrapOnce(attempt+1),10*60*1000);
  }catch(e:any){
    console.error('[wb-site-price-sync]',String(e?.message||e));
    if(attempt<2)setTimeout(()=>void wbPriceBootstrapOnce(attempt+1),10*60*1000);
  }
}

async function clearWbSellerStocksOnce(attempt=0){
  try{
    const settings=await getWarehouseSettings();
    const warehouseId=settings.wbWarehouseId;
    const token=process.env.WB_API_TOKEN?.trim();
    process.env.WB_WAREHOUSE_ID='';
    if(!token||!warehouseId){
      console.log('[wb-3d-stock-sync] skipped',JSON.stringify({configured:Boolean(token),warehouseId:Boolean(warehouseId)}));
      return;
    }

    await ensureSchema();
    const pool=getPool();
    const threeDRows=await pool.query(`SELECT sku FROM products WHERE sku IS NOT NULL AND BTRIM(sku)<>'' AND category='3D-печать'`);
    const threeDSkus=new Set(threeDRows.rows.map((r:any)=>String(r.sku||'').trim()).filter(Boolean));

    const cardsRes=await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list',{
      method:'POST',
      headers:{Authorization:token,'Content-Type':'application/json'},
      body:JSON.stringify({settings:{cursor:{limit:100},filter:{withPhoto:-1},sort:{ascending:false}}}),
      cache:'no-store',
      signal:AbortSignal.timeout(15000)
    });
    const cardsJson=await cardsRes.json().catch(()=>({}));
    if(!cardsRes.ok)throw new Error(String(cardsJson?.message||`WB_CARDS_${cardsRes.status}`));

    const stocks:any[]=[];
    let threeDBarcodes=0;
    for(const card of Array.isArray(cardsJson?.cards)?cardsJson.cards:[]){
      const vendorCode=String(card?.vendorCode||'').trim();
      if(!threeDSkus.has(vendorCode))continue;
      for(const size of Array.isArray(card?.sizes)?card.sizes:[]){
        for(const barcode of Array.isArray(size?.skus)?size.skus:[]){
          if(!barcode)continue;
          stocks.push({sku:String(barcode),amount:5});
          threeDBarcodes++;
        }
      }
    }

    if(!stocks.length){
      console.log('[wb-3d-stock-sync] completed',JSON.stringify({warehouseId,barcodes:0,threeDBarcodes:0,stock3d:5,otherProducts:'unchanged'}));
      return;
    }

    const rr=await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(String(warehouseId))}`,{
      method:'PUT',
      headers:{Authorization:token,'Content-Type':'application/json'},
      body:JSON.stringify({stocks}),
      cache:'no-store',
      signal:AbortSignal.timeout(15000)
    });
    if(rr.status===429){
      console.warn('[wb-3d-stock-sync] rate_limited',JSON.stringify({warehouseId,barcodes:stocks.length,threeDBarcodes,attempt,retryAfter:rr.headers.get('x-ratelimit-retry')||rr.headers.get('retry-after')||null}));
      if(attempt<5)setTimeout(()=>void clearWbSellerStocksOnce(attempt+1),15*60*1000);
      return;
    }
    if(!rr.ok){
      const text=await rr.text().catch(()=>'');
      throw new Error(`WB_3D_STOCK_${rr.status}${text?': '+text.slice(0,500):''}`);
    }
    console.log('[wb-3d-stock-sync] completed',JSON.stringify({warehouseId,barcodes:stocks.length,threeDBarcodes,stock3d:5,otherProducts:'unchanged'}));
  }catch(e:any){
    console.error('[wb-3d-stock-sync]',String(e?.message||e));
    if(attempt<5)setTimeout(()=>void clearWbSellerStocksOnce(attempt+1),15*60*1000);
  }
}

async function publishDskGothToyOnce(){
  try{
    const result=await publishSiteProductToMarketplaces('dskgothtoy1');
    console.log('[marketplace-publish:dskgothtoy1]',JSON.stringify(result));
  }catch(e:any){
    console.error('[marketplace-publish:dskgothtoy1]',String(e?.message||e));
  }
}

async function publishDskGothRingOnce(){
  try{
    const result=await publishSiteProductToMarketplaces('dskgothring1');
    console.log('[marketplace-publish:dskgothring1]',JSON.stringify(result));
  }catch(e:any){
    console.error('[marketplace-publish:dskgothring1]',String(e?.message||e));
  }
}

async function syncRingStockOnce(){
  try{
    const settings=await getWarehouseSettings();
    process.env.WB_WAREHOUSE_ID='';
    if(settings.ozonWarehouseId)process.env.OZON_WAREHOUSE_ID=settings.ozonWarehouseId;
    const result=await pushStockForSku('dskgothring1',10,{wbWarehouseId:null,ozonWarehouseId:settings.ozonWarehouseId});
    console.log('[ring-stock-sync:dskgothring1]',JSON.stringify(result));
  }catch(e:any){
    console.error('[ring-stock-sync:dskgothring1]',String(e?.message||e));
  }
}

async function siteSyncOnce(){
  try{
    const result=await syncHubCatalogToSite();
    console.log('[site-price-sync] completed',JSON.stringify(result));
  }catch(e:any){
    console.error('[site-price-sync]',String(e?.message||e));
  }
}

export async function register(){
  if(process.env.NEXT_RUNTIME!=='nodejs')return;
  // Production marketplace jobs run through the authenticated scheduled route.
  // Opt-in is retained only for local/temporary recovery runs.
  if(process.env.ENABLE_STARTUP_MARKETPLACE_TASKS!=='1')return;

  process.env.WB_WAREHOUSE_ID='';

  if(!g.__techroomWbPriceBootstrapStarted){g.__techroomWbPriceBootstrapStarted=true;setTimeout(()=>void wbPriceBootstrapOnce(),5000);}

  if(!g.__techroomOzonStockTenStarted){
    g.__techroomOzonStockTenStarted=true;
    setTimeout(async()=>{
      try{
        const settings=await getWarehouseSettings();
        if(settings.ozonWarehouseId)process.env.OZON_WAREHOUSE_ID=settings.ozonWarehouseId;
        console.log('[ozon-stock-10] completed',JSON.stringify(await setAllOzonStock(10)));
      }catch(e:any){console.error('[ozon-stock-10]',String(e?.message||e));}
    },7000);
  }

  if(!g.__techroomWbSellerStockClearStarted){
    g.__techroomWbSellerStockClearStarted=true;
    setTimeout(()=>void clearWbSellerStocksOnce(),9000);
  }

  if(!g.__techroomSiteSyncStarted){
    g.__techroomSiteSyncStarted=true;
    setTimeout(()=>void siteSyncOnce(),15000);
  }

  if(!g.__techroomOzonPriceSyncStarted){
    g.__techroomOzonPriceSyncStarted=true;
    setTimeout(()=>void marketplacePriceSyncOnce(),30000);
  }

  if(!g.__techroomDskGothToyPublishStarted){
    g.__techroomDskGothToyPublishStarted=true;
    setTimeout(()=>void publishDskGothToyOnce(),45000);
  }

  if(!g.__techroomDskGothRingPublishStarted){
    g.__techroomDskGothRingPublishStarted=true;
    setTimeout(()=>void publishDskGothRingOnce(),55000);
  }

  if(!g.__techroomRingStockSyncStarted){
    g.__techroomRingStockSyncStarted=true;
    setTimeout(()=>void syncRingStockOnce(),75000);
  }

  if(!g.__techroomPriceGuardTimer){
    setTimeout(()=>void priceGuardCycle(),10000);
    g.__techroomPriceGuardTimer=setInterval(()=>void priceGuardCycle(),60*1000);
    g.__techroomPriceGuardTimer.unref?.();
  }
}
