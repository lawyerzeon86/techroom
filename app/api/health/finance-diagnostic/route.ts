import { NextResponse } from 'next/server';
import { financeDashboard } from '../../../../lib/finance-dashboard';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function safeMessage(e:unknown){
  const raw=e instanceof Error?e.message:String(e);
  return raw.replace(/postgres(?:ql)?:\/\/\S+/gi,'[db]').replace(/https?:\/\/\S+/gi,'[url]').slice(0,300);
}

export async function GET(){
  try{
    const year=new Date().getUTCFullYear();
    const data=await financeDashboard(year);
    return NextResponse.json({
      ok:true,
      year,
      sources:Object.fromEntries(Object.entries(data.channels).map(([k,v]:any)=>[k,{records:v.records,units:v.units}])),
      costRows:data.dataQuality.costTotal
    },{headers:{'Cache-Control':'no-store'}});
  }catch(e){
    return NextResponse.json({ok:false,error:safeMessage(e)},{status:500,headers:{'Cache-Control':'no-store'}});
  }
}
