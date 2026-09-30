import { NextResponse } from 'next/server';
import { syncWildberriesOrders } from '../../../../lib/marketplaces';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function POST(request:Request){
  const forwarded=(request.headers.get('x-forwarded-for')||'').split(',').map(x=>x.trim()).filter(Boolean);
  const source=forwarded.at(-1)||'';
  if(source!=='135.106.196.81')return NextResponse.json({ok:false},{status:401});
  try{const result=await syncWildberriesOrders();return NextResponse.json({ok:true,...result},{headers:{'Cache-Control':'no-store'}});}catch(e:any){return NextResponse.json({ok:false,error:String(e?.message||e)},{status:500});}
}
