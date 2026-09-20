import { NextResponse } from 'next/server';
import { isAdminSession } from '../../../../../lib/security';
import { testAvito } from '../../../../../lib/avito';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
  if(!isAdminSession(request))return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  try{return NextResponse.json(await testAvito())}
  catch(e:any){return NextResponse.json({error:String(e?.message||'Ошибка Avito')},{status:502})}
}
