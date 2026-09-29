import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { refreshSiteCatalogFacts } from '../../../../lib/site-catalog-refresh';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function safeEqual(a:string,b:string){
  const ah=createHash('sha256').update(a).digest();
  const bh=createHash('sha256').update(b).digest();
  return timingSafeEqual(ah,bh);
}

export async function POST(request:Request){
  const configured=process.env.CRON_SYNC_SECRET?.trim()||'';
  const provided=request.headers.get('x-cron-secret')?.trim()||'';
  if(!configured||!provided||!safeEqual(configured,provided)){
    return NextResponse.json({error:'Unauthorized'},{status:401});
  }
  try{
    const result=await refreshSiteCatalogFacts();
    return NextResponse.json({ok:true,...result},{headers:{'Cache-Control':'no-store'}});
  }catch(e:any){
    return NextResponse.json({error:String(e?.message||e)},{status:500,headers:{'Cache-Control':'no-store'}});
  }
}
