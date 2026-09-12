import { NextResponse } from 'next/server';
import { isAdminSession } from '../../../../../lib/security';
import { syncYandexMarketOrders } from '../../../../../lib/yandex-market';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
  if(!isAdminSession(request)) return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  try{
    const result=await syncYandexMarketOrders();
    return NextResponse.json({ok:true,synced:result.synced});
  }catch(error:any){
    return NextResponse.json({error:String(error?.message||'Ошибка синхронизации')},{status:502});
  }
}
