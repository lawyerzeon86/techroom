import { NextResponse } from 'next/server';
import { timingSafeEqual, createHash } from 'node:crypto';
import { runAutomaticMarketplaceSync } from '../../../../lib/auto-sync';

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
  try{
    const result=await runAutomaticMarketplaceSync();
    return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch(error:any){
    return NextResponse.json({error:String(error?.message||'Sync failed')},{status:500});
  }
}
