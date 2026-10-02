import { NextResponse } from 'next/server';
import { isAdminSession,rateLimit,readJsonBody } from '../../../../../lib/security';
import { sendWhatsAppMessage } from '../../../../../lib/whatsapp';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
  if(!isAdminSession(request))return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  const rl=rateLimit(request,'whatsapp-send',30,60_000);if(!rl.ok)return NextResponse.json({error:`Слишком много запросов. Повторите через ${rl.retryAfter} сек.`},{status:429});
  try{
    const body=await readJsonBody(request,16*1024);const phone=String(body?.phone||'');const text=String(body?.text||'');
    const result=await sendWhatsAppMessage(phone,text);return NextResponse.json(result);
  }catch(error:any){return NextResponse.json({error:String(error?.message||'Ошибка отправки WhatsApp')},{status:400})}
}
