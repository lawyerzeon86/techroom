import { runPriceGuard } from './lib/price-guard';
import { syncHubCatalogToSite } from './lib/product-hub';
import { pushPricesAndStocks } from './lib/auto-sync';
import { syncTechRoomPricesFromWildberries } from './lib/wb-price-source';
import { publishOzonAudiXenonCover } from './lib/ozon-card-inspect';

const g=globalThis as typeof globalThis & {
  __techroomPriceGuardTimer?:NodeJS.Timeout;
  __techroomPriceGuardBusy?:boolean;
  __techroomSiteSyncStarted?:boolean;
  __techroomOzonPriceSyncStarted?:boolean;
  __techroomWbPriceBootstrapStarted?:boolean;
  __techroomOzonCardInspectStarted?:boolean;
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

  if(!g.__techroomOzonCardInspectStarted){g.__techroomOzonCardInspectStarted=true;setTimeout(()=>void publishOzonAudiXenonCover().then(r=>console.log('[ozon-card-publish]',JSON.stringify(r))).catch(e=>console.error('[ozon-card-publish]',String(e?.message||e))).catch(e=>console.error('[ozon-card-inspect]',String(e?.message||e))),8000);}

  if(!g.__techroomWbPriceBootstrapStarted){g.__techroomWbPriceBootstrapStarted=true;setTimeout(()=>void wbPriceBootstrapOnce(),5000);}

  if(!g.__techroomSiteSyncStarted){
    g.__techroomSiteSyncStarted=true;
    setTimeout(()=>void siteSyncOnce(),15000);
  }

  if(!g.__techroomOzonPriceSyncStarted){
    g.__techroomOzonPriceSyncStarted=true;
    setTimeout(()=>void marketplacePriceSyncOnce(),30000);
  }

  if(!g.__techroomPriceGuardTimer){
    setTimeout(()=>void priceGuardCycle(),45000);
    g.__techroomPriceGuardTimer=setInterval(()=>void priceGuardCycle(),3*60*1000);
    g.__techroomPriceGuardTimer.unref?.();
  }
}
