import { NextResponse } from 'next/server';
import { ensureSchema, getPool } from '../../../../lib/db';
import { isAdminSession } from '../../../../lib/security';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const money=(v:any)=>Number.isFinite(Number(v))?Number(v):0;
async function setup(){
  await ensureSchema();
  await getPool().query(`CREATE TABLE IF NOT EXISTS marketplace_finance_pages (
    source TEXT NOT NULL, month CHAR(7) NOT NULL, page INTEGER NOT NULL,
    payload JSONB NOT NULL, fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(source,month,page))`);
}
async function store(source:string,month:string,page:number,rows:any[]){
  await getPool().query(`INSERT INTO marketplace_finance_pages(source,month,page,payload)
    VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT(source,month,page)
    DO UPDATE SET payload=EXCLUDED.payload,fetched_at=NOW()`,[source,month,page,JSON.stringify(rows)]);
}
async function fetchRows(url:string,headers:Record<string,string>,body:any){
  const r=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(25000)});
  if(r.status===204)return [];
  if(!r.ok)throw new Error('MARKETPLACE_HTTP_'+r.status);
  return await r.json();
}
async function wildberries(month:string){
  const token=process.env.WB_FINANCE_TOKEN?.trim()||process.env.WB_API_TOKEN?.trim();
  if(!token)return {status:'missing_finance_token'};
  const prior=await getPool().query("SELECT page,payload FROM marketplace_finance_pages WHERE source='wildberries' AND month=$1 ORDER BY page DESC LIMIT 1",[month]);
  const last=prior.rows[0],lastRows=Array.isArray(last?.payload)?last.payload:[];
  if(last&&lastRows.length<100000)return {status:'complete',pages:Number(last.page)+1};
  const rrdId=lastRows.length?money(lastRows[lastRows.length-1]?.rrdId):0;
  const page=last?Number(last.page)+1:0;
  const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
  const rows=await fetchRows('https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed',
    {Authorization:token},{dateFrom:month+'-01',dateTo:end,limit:100000,rrdId});
  if(!Array.isArray(rows))throw new Error('WB_INVALID_RESPONSE');
  if(page>0&&rows.length&&money(rows[rows.length-1]?.rrdId)<=rrdId)throw new Error('WB_CURSOR_ERROR');
  await store('wildberries',month,page,rows);
  return {status:rows.length<100000?'complete':'more_pages',pages:page+1,rows:rows.length};
}
async function ozon(month:string){
  const client=process.env.OZON_CLIENT_ID?.trim(),key=process.env.OZON_API_KEY?.trim();
  if(!client||!key)return {status:'missing_credentials'};
  const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0,23,59,59)).toISOString();
  let total=Number.MAX_SAFE_INTEGER,page=1,count=0;
  // At most 20 pages per call; repeat to complete particularly large months.
  const existing=await getPool().query("SELECT max(page) AS page FROM marketplace_finance_pages WHERE source='ozon' AND month=$1",[month]);
  if(existing.rows[0]?.page)page=Number(existing.rows[0].page)+1;
  for(let i=0;i<20&&page<=total;i++,page++){
    const data=await fetchRows('https://api-seller.ozon.ru/v3/finance/transaction/list',
      {'Client-Id':client,'Api-Key':key},
      {filter:{date:{from:month+'-01T00:00:00Z',to:end},operation_type:[],posting_number:''},page,page_size:1000});
    if(!Array.isArray(data?.result?.operations))throw new Error('OZON_INVALID_RESPONSE');
    total=Number(data.result.page_count)||0;
    await store('ozon',month,page,data.result.operations);
    count+=data.result.operations.length;
  }
  return {status:page>total?'complete':'more_pages',pages:page-1,totalPages:total,rowsThisRun:count};
}
export async function GET(request:Request){
  if(!isAdminSession(request))return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  const u=new URL(request.url),month=u.searchParams.get('month')||'',source=u.searchParams.get('source');
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return NextResponse.json({error:'month=YYYY-MM required'},{status:400});
  try{
    await setup();
    let sync:any=null;
    if(u.searchParams.get('sync')==='1'){
      if(source!=='ozon'&&source!=='wildberries')return NextResponse.json({error:'source=ozon or wildberries required'},{status:400});
      try{sync=source==='ozon'?await ozon(month):await wildberries(month)}
      catch(e:any){sync={status:'error',code:String(e?.message||e)}}
    }
    const r=await getPool().query('SELECT source,page,payload,fetched_at FROM marketplace_finance_pages WHERE month=$1 ORDER BY source,page',[month]);
    const channels:any={};
    for(const name of ['wildberries','ozon']){
      const pages=r.rows.filter((x:any)=>x.source===name),rows=pages.flatMap((x:any)=>Array.isArray(x.payload)?x.payload:[]);
      channels[name]={pages:pages.length,records:rows.length,updatedAt:pages.at(-1)?.fetched_at||null,
        rawRetailRub:name==='wildberries'?Math.round(rows.reduce((s:number,x:any)=>s+money(x.retailAmount),0)*100)/100:null,
        netOperationsRub:name==='ozon'?Math.round(rows.reduce((s:number,x:any)=>s+money(x.amount),0)*100)/100:null,
        netProfitRub:null};
    }
    const site=await getPool().query(`SELECT COUNT(*)::int AS paid_orders,COALESCE(SUM(total_amount),0) AS paid_gross
      FROM orders WHERE created_at >= $1::timestamp AND created_at < ($1::timestamp+interval '1 month')
      AND (payment_status='succeeded' OR paid_at IS NOT NULL)`,[month+'-01']);
    return NextResponse.json({month,channels,site:site.rows[0],sync,
      note:'Raw finance figures are not comparable sales totals or net profit. Cost prices, ads, taxes and cross-period adjustments must be reconciled.'},{headers:{'Cache-Control':'no-store'}});
  }catch(e){console.error('FINANCE_REPORT_FAILED',e);return NextResponse.json({error:'Не удалось получить отчёт'},{status:500})}
}
