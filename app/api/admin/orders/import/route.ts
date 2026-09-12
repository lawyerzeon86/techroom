import { NextResponse } from 'next/server';
import { ensureSchema, getPool } from '../../../../../lib/db';
import { isAdminSession } from '../../../../../lib/security';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const allowedSources=new Set(['avito','megamarket','aliexpress','other']);

function authorized(request:Request){
  if(isAdminSession(request)) return true;
  const expected=process.env.MARKETPLACE_IMPORT_SECRET?.trim();
  const actual=request.headers.get('x-import-secret')?.trim();
  return Boolean(expected&&actual&&expected===actual);
}

export async function POST(request:Request){
  if(!authorized(request)) return NextResponse.json({error:'Unauthorized'},{status:401});
  try{
    const body=await request.json();
    const orders=Array.isArray(body?.orders)?body.orders:[body];
    await ensureSchema();
    const pool=getPool();
    let imported=0;
    for(const raw of orders){
      const source=String(raw?.source||'').toLowerCase();
      if(!allowedSources.has(source)) throw new Error(`UNSUPPORTED_SOURCE_${source||'EMPTY'}`);
      const externalId=String(raw?.externalId??raw?.id??raw?.orderNumber??'').trim();
      if(!externalId) throw new Error('EXTERNAL_ID_REQUIRED');
      const items=Array.isArray(raw?.items)?raw.items:[];
      const totalAmount=Math.round(Number(raw?.totalAmount??raw?.amount??0)||0);
      await pool.query(`
        INSERT INTO marketplace_orders
          (source,external_id,order_number,status,total_amount,customer_name,phone,items,raw_payload,external_created_at,synced_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,NOW(),NOW())
        ON CONFLICT(source,external_id) DO UPDATE SET
          order_number=EXCLUDED.order_number,
          status=EXCLUDED.status,
          total_amount=EXCLUDED.total_amount,
          customer_name=EXCLUDED.customer_name,
          phone=EXCLUDED.phone,
          items=EXCLUDED.items,
          raw_payload=EXCLUDED.raw_payload,
          external_created_at=COALESCE(EXCLUDED.external_created_at,marketplace_orders.external_created_at),
          synced_at=NOW(),updated_at=NOW()
      `,[
        source,externalId,String(raw?.orderNumber??externalId),String(raw?.status??'unknown'),totalAmount,
        raw?.customerName??null,raw?.phone??null,JSON.stringify(items),JSON.stringify(raw),raw?.createdAt??null
      ]);
      imported++;
    }
    return NextResponse.json({ok:true,imported});
  }catch(error:any){
    return NextResponse.json({error:String(error?.message||'IMPORT_FAILED')},{status:400});
  }
}
