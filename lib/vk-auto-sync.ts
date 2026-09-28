import { syncOzonToVk, vkConfigured } from './vk-market';

const g=globalThis as typeof globalThis & {
  __techroomVkCatalogTimer?:NodeJS.Timeout;
  __techroomVkCatalogBusy?:boolean;
};

async function runVkCatalogSync(){
  if(g.__techroomVkCatalogBusy)return;
  if(!vkConfigured())return;
  if(!process.env.OZON_CLIENT_ID?.trim()||!process.env.OZON_API_KEY?.trim())return;
  g.__techroomVkCatalogBusy=true;
  try{
    const result=await syncOzonToVk(100);
    console.log('[vk-catalog-sync]',JSON.stringify({total:result.total,created:result.created,updated:result.updated,failed:result.failed}));
  }catch(e:any){
    console.error('[vk-catalog-sync]',String(e?.message||e));
  }finally{
    g.__techroomVkCatalogBusy=false;
  }
}

if(typeof process!=='undefined'&&process.env.NEXT_RUNTIME!=='edge'&&!g.__techroomVkCatalogTimer){
  setTimeout(()=>void runVkCatalogSync(),60_000);
  g.__techroomVkCatalogTimer=setInterval(()=>void runVkCatalogSync(),30*60_000);
  g.__techroomVkCatalogTimer.unref?.();
}
