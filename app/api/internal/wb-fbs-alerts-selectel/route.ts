import { NextResponse } from 'next/server';
import { syncWildberriesOrders } from '../../../../lib/marketplaces';
export const runtime='nodejs'; export const dynamic='force-dynamic';
declare global { var __duisunWbFbsLastRun: number | undefined; }
export async function POST(){
  const now=Date.now();
  if(globalThis.__duisunWbFbsLastRun&&now-globalThis.__duisunWbFbsLastRun<120_000)return NextResponse.json({ok:true,skipped:'throttled'});
  globalThis.__duisunWbFbsLastRun=now;
  try{const result=await syncWildberriesOrders();return NextResponse.json({ok:true,...result},{headers:{'Cache-Control':'no-store'}});}catch(e:any){return NextResponse.json({ok:false,error:String(e?.message||e)},{status:500});}
}
