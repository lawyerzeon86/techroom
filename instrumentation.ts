import { runAutomaticMarketplaceSync } from './lib/auto-sync';
import { syncHubCatalogToSite } from './lib/product-hub';
import { runPriceGuard } from './lib/price-guard';

const g=globalThis as typeof globalThis & {
  __techroomMarketplaceTimer?:NodeJS.Timeout;
  __techroomMarketplaceBusy?:boolean;
  __techroomPriceGuardTimer?:NodeJS.Timeout;
  __techroomPriceGuardBusy?:boolean;
};

async function cycle(){
  if(g.__techroomMarketplaceBusy)return;
  g.__techroomMarketplaceBusy=true;
  try{
    await runAutomaticMarketplaceSync();
    await syncHubCatalogToSite();
    console.log('[marketplace-sync] completed');
  }catch(e:any){
    console.error('[marketplace-sync]',String(e?.message||e));
  }finally{
    g.__techroomMarketplaceBusy=false;
  }
}

async function priceGuardCycle(){
  if(g.__techroomPriceGuardBusy)return;
  g.__techroomPriceGuardBusy=true;
  try{
    const result=await runPriceGuard();
    console.log('[price-guard] completed',JSON.stringify({raised:result.raised||0,checkedAt:result.checkedAt||null}));
  }catch(e:any){
    console.error('[price-guard]',String(e?.message||e));
  }finally{
    g.__techroomPriceGuardBusy=false;
  }
}

export async function register(){
  if(process.env.NEXT_RUNTIME!=='nodejs')return;

  if(!g.__techroomMarketplaceTimer){
    setTimeout(()=>void cycle(),30000);
    g.__techroomMarketplaceTimer=setInterval(()=>void cycle(),15*60*1000);
    g.__techroomMarketplaceTimer.unref?.();
  }

  if(!g.__techroomPriceGuardTimer){
    setTimeout(()=>void priceGuardCycle(),45000);
    g.__techroomPriceGuardTimer=setInterval(()=>void priceGuardCycle(),3*60*1000);
    g.__techroomPriceGuardTimer.unref?.();
  }
}
