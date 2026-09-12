import { NextResponse } from 'next/server';
import { testMarketplace } from '../../../../lib/marketplaces';
import { listCommunications } from '../../../../lib/communications';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(){
  const result:any={};
  for(const marketplace of ['wildberries','ozon'] as const){
    result[marketplace]={};
    try{ result[marketplace].orders=await testMarketplace(marketplace); }
    catch(e:any){ result[marketplace].orders={ok:false,error:String(e?.message||e)}; }
    for(const type of ['reviews','questions'] as const){
      try{
        const r=await listCommunications(marketplace,type);
        result[marketplace][type]={ok:true,count:Number(r?.total??r?.items?.length??0)};
      }catch(e:any){
        result[marketplace][type]={ok:false,error:String(e?.message||e)};
      }
    }
  }
  return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
}
