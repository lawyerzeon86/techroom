import { NextResponse } from 'next/server';
import { isAdminSession } from '../../../../lib/security';
import { listWhatsAppMessages,listWhatsAppThreads,whatsappStatus } from '../../../../lib/whatsapp';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request){
  if(!isAdminSession(request))return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  const url=new URL(request.url);const phone=url.searchParams.get('phone')||'';
  try{
    if(phone)return NextResponse.json({ok:true,status:whatsappStatus(),messages:await listWhatsAppMessages(phone)});
    return NextResponse.json({ok:true,status:whatsappStatus(),threads:await listWhatsAppThreads()});
  }catch(error:any){return NextResponse.json({error:String(error?.message||'Ошибка WhatsApp')},{status:502})}
}
