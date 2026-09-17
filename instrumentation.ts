import { runPriceGuard } from './lib/price-guard';

const g=globalThis as typeof globalThis & {
  __techroomPriceGuardTimer?:NodeJS.Timeout;
  __techroomPriceGuardBusy?:boolean;
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

export async function register(){
  if(process.env.NEXT_RUNTIME!=='nodejs'||g.__techroomPriceGuardTimer)return;
  setTimeout(()=>void priceGuardCycle(),45000);
  g.__techroomPriceGuardTimer=setInterval(()=>void priceGuardCycle(),3*60*1000);
  g.__techroomPriceGuardTimer.unref?.();
}
