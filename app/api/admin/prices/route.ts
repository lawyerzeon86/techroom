import { NextResponse } from 'next/server';
import { isAdminSession, rateLimit, readJsonBody } from '../../../../lib/security';
import { listPriceSheet, priceSheetMarketplaceStatus, savePriceSheet } from '../../../../lib/price-sheet';
import { pushPricesAndStocks } from '../../../../lib/auto-sync';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request){
  if(!isAdminSession(request))return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  try{
    return NextResponse.json({items:await listPriceSheet(),marketplaces:priceSheetMarketplaceStatus()},{headers:{'Cache-Control':'no-store'}});
  }catch(e:any){
    return NextResponse.json({error:String(e?.message||'Не удалось загрузить лист цен')},{status:500});
  }
}

export async function PATCH(request:Request){
  if(!isAdminSession(request))return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  const limit=rateLimit(request,'price-sheet-write',60,60*1000);
  if(!limit.ok)return NextResponse.json({error:'Слишком много запросов'},{status:429,headers:{'Retry-After':String(limit.retryAfter)}});
  try{
    const body=await readJsonBody(request,512*1024);
    const items=await savePriceSheet(body?.items);
    return NextResponse.json({ok:true,items},{headers:{'Cache-Control':'no-store'}});
  }catch(e:any){
    const status=['VALIDATION','SKU_NOT_FOUND','INVALID_JSON'].includes(String(e?.message))?400:500;
    return NextResponse.json({error:status===400?'Проверь цены и SKU':String(e?.message||'Не удалось сохранить цены')},{status});
  }
}

export async function POST(request:Request){
  if(!isAdminSession(request))return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  const limit=rateLimit(request,'price-sheet-sync',12,60*1000);
  if(!limit.ok)return NextResponse.json({error:'Слишком много запусков синхронизации'},{status:429,headers:{'Retry-After':String(limit.retryAfter)}});
  try{
    const result=await pushPricesAndStocks({onlyPrices:true});
    return NextResponse.json({ok:true,result},{headers:{'Cache-Control':'no-store'}});
  }catch(e:any){
    return NextResponse.json({error:String(e?.message||'Не удалось выгрузить цены')},{status:502});
  }
}
