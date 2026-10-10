import { NextResponse } from 'next/server';
import { isAdminSession, readJsonBody, rateLimit } from '../../../../../../lib/security';
import { getPool } from '../../../../../../lib/db';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function num(v:any){const n=Number(v);return Number.isFinite(n)?n:0}
function clean(v:any,max=500){const s=String(v??'').trim();return s.slice(0,max)}
function isoDate(v:any){
  const s=clean(v,64);
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m)return m[1]+'-'+m[2]+'-'+m[3];
  const d=new Date(s);
  return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):null;
}
function currency(v:any){
  const s=clean(v,16).toUpperCase();
  const map:any={'₽':'RUB','RUR':'RUB','РУБ':'RUB','₸':'KZT','ТЕНГЕ':'KZT','$':'USD','€':'EUR','RMB':'CNY','ЮАНЬ':'CNY'};
  const x=map[s]||s||'RUB';
  return /^[A-Z]{3}$/.test(x)?x:'RUB';
}

export async function POST(request:Request){
  if(!isAdminSession(request))return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  const limit=rateLimit(request,'avito-finance-import',12,60*1000);
  if(!limit.ok)return NextResponse.json({error:'Слишком много импортов'},{status:429,headers:{'Retry-After':String(limit.retryAfter)}});
  try{
    const body=await readJsonBody(request,4*1024*1024);
    const rows=Array.isArray(body?.rows)?body.rows:[];
    if(!rows.length||rows.length>10000)return NextResponse.json({error:'Нет строк для импорта'},{status:400});

    const normalized=rows.map((x:any,i:number)=>{
      const date=isoDate(x?.date||x?.createdAt||x?.created_at||x?.completedAt||x?.completed_at);
      if(!date)throw new Error('INVALID_DATE_'+i);
      const amount=num(x?.amount??x?.sales??x?.price);
      const net=num(x?.net??x?.payout??x?.amount??x?.sales??x?.price);
      return {
        date,
        amount,
        net,
        currency:currency(x?.currency||x?.currency_code),
        quantity:Math.max(1,Math.round(num(x?.quantity)||1)),
        sku:clean(x?.sku,160),
        title:clean(x?.title,500),
        status:clean(x?.status||x?.state||'completed',80),
        orderId:clean(x?.orderId||x?.order_id||x?.id,160),
        itemId:clean(x?.itemId||x?.item_id,160),
        sourceKind:clean(x?.sourceKind||x?.source_kind||'browser',80),
        rawRef:clean(x?.rawRef||x?.raw_ref,500)
      };
    });

    const groups=new Map<string,any[]>();
    for(const row of normalized){
      const month=row.date.slice(0,7);
      if(!groups.has(month))groups.set(month,[]);
      groups.get(month)!.push(row);
    }

    const pool=getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketplace_finance_pages(
        source TEXT NOT NULL,month CHAR(7) NOT NULL,page INTEGER NOT NULL,
        payload JSONB NOT NULL,fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(source,month,page)
      )
    `);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      for(const [month,items] of groups){
        await client.query("DELETE FROM marketplace_finance_pages WHERE source='avito' AND month=$1",[month]);
        const chunk=1000;
        for(let i=0,page=0;i<items.length;i+=chunk,page++){
          await client.query(
            "INSERT INTO marketplace_finance_pages(source,month,page,payload,fetched_at) VALUES('avito',$1,$2,$3::jsonb,NOW())",
            [month,page,JSON.stringify(items.slice(i,i+chunk))]
          );
        }
      }
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}

    return NextResponse.json({ok:true,months:[...groups.keys()].sort(),rows:normalized.length},{headers:{'Cache-Control':'no-store'}});
  }catch(e:any){
    return NextResponse.json({error:String(e?.message||'Не удалось импортировать Avito')},{status:400});
  }
}
