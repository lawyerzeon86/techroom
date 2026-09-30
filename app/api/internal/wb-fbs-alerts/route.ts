import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { syncWildberriesOrders } from '../../../../lib/marketplaces';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function safeEqual(a:string,b:string){
  const ah=createHash('sha256').update(a).digest();
  const bh=createHash('sha256').update(b).digest();
  return timingSafeEqual(ah,bh);
}

export async function POST(request:Request){
  const configured=process.env.CRON_SYNC_SECRET?.trim();
  const provided=request.headers.get('x-cron-secret')?.trim()||'';
  if(!configured||!provided||!safeEqual(configured,provided)){
    return NextResponse.json({error:'Unauthorized'},{status:401});
  }
  if(!process.env.WB_API_TOKEN?.trim()){
    return NextResponse.json({ok:false,error:'WB_API_TOKEN_NOT_CONFIGURED'},{status:503});
  }
  try{
    const result=await syncWildberriesOrders();
    return NextResponse.json({ok:true,...result},{headers:{'Cache-Control':'no-store'}});
  }catch(error:any){
    return NextResponse.json({ok:false,error:String(error?.message||error)},{status:500});
  }
}
