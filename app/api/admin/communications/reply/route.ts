import { NextResponse } from 'next/server';
import { isAdminSession, readJsonBody } from '../../../../../lib/security';
import { replyCommunication, type CommunicationType } from '../../../../../lib/communications';
import type { MarketplaceName } from '../../../../../lib/marketplaces';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
  if(!isAdminSession(request)) return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  try{
    const body=await readJsonBody(request,16*1024);
    const marketplace=String(body?.marketplace||'') as MarketplaceName;
    const type=String(body?.type||'') as CommunicationType;
    const id=String(body?.id||'').trim();
    const text=String(body?.text||'').trim();
    const sku=body?.sku??null;
    if(!['wildberries','ozon'].includes(marketplace)) return NextResponse.json({error:'Неизвестный маркетплейс'},{status:400});
    if(!['reviews','questions'].includes(type)) return NextResponse.json({error:'Неизвестный тип'},{status:400});
    if(!id) return NextResponse.json({error:'Нет ID обращения'},{status:400});
    if(text.length<2||text.length>5000) return NextResponse.json({error:'Ответ должен быть от 2 до 5000 символов'},{status:400});
    const result=await replyCommunication({marketplace,type,id,text,sku});
    return NextResponse.json(result);
  }catch(error:any){
    const msg=String(error?.message||'Ошибка отправки');
    const status=msg==='OZON_SKU_REQUIRED'?400:502;
    return NextResponse.json({error:msg==='OZON_SKU_REQUIRED'?'Для ответа на вопрос Ozon не найден SKU товара':msg},{status});
  }
}
