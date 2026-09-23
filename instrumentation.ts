import { runPriceGuard } from './lib/price-guard';
import { syncHubCatalogToSite } from './lib/product-hub';
import { pushPricesAndStocks, pushStockForSku } from './lib/auto-sync';
import { syncTechRoomPricesFromWildberries } from './lib/wb-price-source';
import { publishSiteProductToMarketplaces } from './lib/site-product-publish';
import { getWarehouseSettings } from './lib/marketplace-settings';

const g=globalThis as typeof globalThis & {
  __techroomPriceGuardTimer?:NodeJS.Timeout;
  __techroomPriceGuardBusy?:boolean;
  __techroomSiteSyncStarted?:boolean;
  __techroomOzonPriceSyncStarted?:boolean;
  __techroomWbPriceBootstrapStarted?:boolean;
  __techroomDskGothToyPublishStarted?:boolean;
  __techroomDskGothRingPublishStarted?:boolean;
  __techroomRingStockSyncStarted?:boolean;
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
    if(settings.wbWarehouseId)process.env.WB_WAREHOUSE_ID=settings.wbWarehouseId;
    if(settings.ozonWarehouseId)process.env.OZON_WAREHOUSE_ID=settings.ozonWarehouseId;
    const result=await pushStockForSku('dskgothring1',5,settings);
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



  if(!g.__techroomWbPriceBootstrapStarted){g.__techroomWbPriceBootstrapStarted=true;setTimeout(()=>void wbPriceBootstrapOnce(),5000);}

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
