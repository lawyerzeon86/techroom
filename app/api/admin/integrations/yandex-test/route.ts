import { NextResponse } from 'next/server';
import { isAdminSession } from '../../../../../lib/security';
import { testYandexMarket } from '../../../../../lib/yandex-market';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
  if(!isAdminSession(request)) return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  try{
    return NextResponse.json(await testYandexMarket());
  }catch(error:any){
    return NextResponse.json({error:String(error?.message||'Ошибка подключения')},{status:502});
  }
}
