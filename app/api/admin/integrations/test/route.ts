import { NextResponse } from 'next/server';
import { isAdminSession, readJsonBody } from '../../../../../lib/security';
import { testMarketplace, type MarketplaceName } from '../../../../../lib/marketplaces';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
  if(!isAdminSession(request)) return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  try{
    const body=await readJsonBody(request);
    const marketplace=String(body?.marketplace||'') as MarketplaceName;
    if(!['wildberries','ozon'].includes(marketplace)) return NextResponse.json({error:'Неизвестный маркетплейс'},{status:400});
    const result=await testMarketplace(marketplace);
    return NextResponse.json(result);
  }catch(error:any){
    return NextResponse.json({error:String(error?.message||'Ошибка подключения')},{status:502});
  }
}
