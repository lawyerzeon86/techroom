import { NextResponse } from 'next/server';
import { ensureSchema, getPool } from '../../../../../lib/db';
import { isAdminSession, readJsonBody } from '../../../../../lib/security';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const ALLOWED=['new','confirmed','shipped','completed','cancelled'];

export async function POST(request:Request){
  if(!isAdminSession(request)) return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  const body=await readJsonBody(request);
  const id=String(body?.id||'');
  const status=String(body?.status||'');
  if(!/^\d+$/.test(id)||!ALLOWED.includes(status)) return NextResponse.json({error:'Некорректные данные'},{status:400});
  await ensureSchema();
  const result=await getPool().query('UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING id,status',[status,id]);
  if(!result.rowCount) return NextResponse.json({error:'Заказ не найден'},{status:404});
  return NextResponse.json({ok:true,status});
}
