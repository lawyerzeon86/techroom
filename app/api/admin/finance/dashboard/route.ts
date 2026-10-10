import { NextResponse } from 'next/server';
import { isAdminSession } from '../../../../../lib/security';
import { financeDashboard } from '../../../../../lib/finance-dashboard';
export const runtime='nodejs';export const dynamic='force-dynamic'; // diagnostic trigger
export async function GET(request:Request){
 if(!isAdminSession(request))return NextResponse.json({error:'Требуется вход администратора'},{status:401});
 const y=Number(new URL(request.url).searchParams.get('year')||new Date().getUTCFullYear());
 if(!Number.isInteger(y)||y<2022||y>2100)return NextResponse.json({error:'Некорректный год'},{status:400});
 try{return NextResponse.json(await financeDashboard(y),{headers:{'Cache-Control':'no-store'}})}
 catch(e){const detail=e instanceof Error?e.message:String(e);console.error('FINANCE_DASHBOARD_FAILED',e);return NextResponse.json({error:'Не удалось рассчитать финансовый дашборд',detail},{status:500,headers:{'Cache-Control':'no-store'}})}
}
