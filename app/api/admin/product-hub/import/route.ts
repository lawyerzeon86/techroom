import { NextResponse } from 'next/server';
import { isAdminSession, readJsonBody } from '../../../../../lib/security';
import { importMarketplaceProducts, runAutoProductTransfers, saveTransferRule, type HubMarketplace } from '../../../../../lib/product-hub';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
  if(!isAdminSession(request)) return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  try{
    const body=await readJsonBody(request);
    const marketplace=String(body?.marketplace||'') as HubMarketplace;
    if(!['wb','ozon'].includes(marketplace)) return NextResponse.json({error:'Неизвестный источник'},{status:400});
    const imported=await importMarketplaceProducts(marketplace,100);
    let transfer:any=null;
    const target=String(body?.target||'') as HubMarketplace;
    if(['wb','ozon'].includes(target)&&target!==marketplace){
      await saveTransferRule(marketplace,target,true,body?.autoPublish!==false);
      transfer=await runAutoProductTransfers();
    }
    return NextResponse.json({ok:true,...imported,transfer});
  }catch(e:any){
    return NextResponse.json({error:String(e?.message||'Ошибка импорта')},{status:502});
  }
}
