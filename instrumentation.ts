import { runAutomaticMarketplaceSync } from './lib/auto-sync';
import { syncHubCatalogToSite } from './lib/product-hub';

const g=globalThis as typeof globalThis & {__techroomMarketplaceTimer?:NodeJS.Timeout;__techroomMarketplaceBusy?:boolean};

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

export async function register(){
  if(process.env.NEXT_RUNTIME!=='nodejs'||g.__techroomMarketplaceTimer)return;
  setTimeout(()=>void cycle(),30000);
  g.__techroomMarketplaceTimer=setInterval(()=>void cycle(),15*60*1000);
  g.__techroomMarketplaceTimer.unref?.();
}
