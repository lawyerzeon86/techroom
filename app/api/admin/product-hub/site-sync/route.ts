import { NextResponse } from 'next/server';
import { isAdminSession } from '../../../../../lib/security';
import { syncHubCatalogToSite } from '../../../../../lib/product-hub';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
  if(!isAdminSession(request)) return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  try{
    return NextResponse.json({ok:true,...await syncHubCatalogToSite()});
  }catch(e:any){
    return NextResponse.json({error:String(e?.message||'Ошибка синхронизации каталога')},{status:502});
  }
}
