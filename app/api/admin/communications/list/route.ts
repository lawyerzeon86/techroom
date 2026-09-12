import { NextResponse } from 'next/server';
import { isAdminSession } from '../../../../../lib/security';
import { listCommunications, type CommunicationType } from '../../../../../lib/communications';
import type { MarketplaceName } from '../../../../../lib/marketplaces';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request){
  if(!isAdminSession(request)) return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  try{
    const url=new URL(request.url);
    const marketplace=String(url.searchParams.get('marketplace')||'') as MarketplaceName;
    const type=String(url.searchParams.get('type')||'') as CommunicationType;
    if(!['wildberries','ozon'].includes(marketplace)) return NextResponse.json({error:'Неизвестный маркетплейс'},{status:400});
    if(!['reviews','questions'].includes(type)) return NextResponse.json({error:'Неизвестный тип'},{status:400});
    const result=await listCommunications(marketplace,type);
    return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch(error:any){
    return NextResponse.json({error:String(error?.message||'Ошибка загрузки')},{status:502});
  }
}
