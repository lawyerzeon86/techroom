import { NextResponse } from 'next/server';
import { isAdminSession } from '../../../../../../lib/security';
import { testVk } from '../../../../../../lib/vk-market';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
  if(!isAdminSession(request)) return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  try{return NextResponse.json(await testVk())}
  catch(e:any){return NextResponse.json({error:String(e?.message||e)},{status:502})}
}
