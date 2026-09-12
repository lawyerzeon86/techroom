import { NextResponse } from 'next/server';
import { isAdminSession } from '../../../../lib/security';
import { listHubProducts, listTransferRules } from '../../../../lib/product-hub';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request){
  if(!isAdminSession(request)) return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  try{
    const products=await listHubProducts();
    const rules=await listTransferRules();
    return NextResponse.json({products,rules},{headers:{'Cache-Control':'no-store'}});
  }catch(e:any){
    return NextResponse.json({error:String(e?.message||'Ошибка Product Hub')},{status:502});
  }
}
