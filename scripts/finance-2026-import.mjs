#!/usr/bin/env node
// Read-only marketplace API import into local finance storage; no secrets printed.
import pg from 'pg';
const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=new Date();
const lastMonth=until.getUTCFullYear()===2026?until.getUTCMonth()+1:12;
const out={year:2026,wildberries:[],ozon:[]};
async function save(source,month,page,data){
  await pool.query(`INSERT INTO marketplace_finance_pages(source,month,page,payload)
  VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(source,month,page)
  DO UPDATE SET payload=EXCLUDED.payload,fetched_at=NOW()`,[source,month,page,JSON.stringify(data)]);
}
async function request(url,headers,body){
  for(let attempt=0;attempt<5;attempt++){
    const r=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(50000)});
    if(r.status===204)return [];
    if(r.status===429||r.status===503){
      if(attempt===4)throw Error('HTTP_'+r.status);
      const delay=Math.max(61000,Number(r.headers.get('retry-after')||0)*1000);
      await sleep(delay);continue;
    }
    if(!r.ok)throw Error('HTTP_'+r.status);
    return r.json();
  }
}
try{
  await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_finance_pages (
    source TEXT NOT NULL,month CHAR(7) NOT NULL,page INTEGER NOT NULL,
    payload JSONB NOT NULL,fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(source,month,page))`);
  const ytdEnd=(until.getUTCFullYear()===2026?until:new Date(Date.UTC(2026,11,31,23,59,59))).toISOString().slice(0,10);
  const wb=process.env.WB_FINANCE_TOKEN||process.env.WB_API_TOKEN;
  if(wb){
    try{
      let cursor=0,page=0;
      for(let p=0;p<20;p++){
        if(p>0) await sleep(61000);
        const data=await request('https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed',
          {Authorization:wb},{dateFrom:'2026-01-01',dateTo:ytdEnd,limit:100000,rrdId:cursor});
        if(!Array.isArray(data))throw Error('INVALID_RESPONSE');
        if(!data.length){out.wildberries.push({status:'complete',pages:page});break;}
        const next=Number(data.at(-1).rrdId??data.at(-1).rrd_id??0);
        if(next<=cursor)throw Error('INVALID_CURSOR');
        cursor=next;
        const byMonth=new Map();
        for(const row of data){
          const d=String(row.sale_dt||row.order_dt||row.date_from||row.create_dt||'2026-01').slice(0,7);
          const month=/^2026-(0[1-9]|1[0-2])$/.test(d)?d:'2026-01';
          if(!byMonth.has(month))byMonth.set(month,[]);
          byMonth.get(month).push(row);
        }
        for(const [month,rows] of byMonth) await save('wildberries',month,page,rows);
        page++;
        if(data.length<100000){out.wildberries.push({status:'complete',pages:page,rows:data.length});break;}
        if(p===19)out.wildberries.push({status:'page_limit',pages:page});
      }
    }catch(e){out.wildberries.push({status:'error',reason:String(e.message)});}
  }else out.wildberries.push({status:'missing_token'});

  const client=process.env.OZON_CLIENT_ID,key=process.env.OZON_API_KEY;
  if(client&&key){
    const headers={'Client-Id':client,'Api-Key':key};
    const startDate=new Date(Date.UTC(2026,0,1));
    const endDate=until.getUTCFullYear()===2026?until:new Date(Date.UTC(2026,11,31));
    let days=0, rows=0, pages=0, errors=0;
    for(let d=new Date(startDate);d<=endDate;d.setUTCDate(d.getUTCDate()+1)){
      const date=d.toISOString().slice(0,10);
      const month=date.slice(0,7);
      const dayIndex=Math.floor((d.getTime()-startDate.getTime())/86400000);
      let lastId='', part=0;
      try{
        for(;part<100;part++){
          const data=await request('https://api-seller.ozon.ru/v1/finance/accrual/by-day',headers,{date,last_id:lastId});
          const accruals=Array.isArray(data?.accruals)?data.accruals:(Array.isArray(data?.result?.accruals)?data.result.accruals:[]);
          const next=String(data?.last_id??data?.result?.last_id??'');
          if(accruals.length) await save('ozon',month,dayIndex*100+part,accruals);
          rows+=accruals.length; pages++; 
          if(!next||next===lastId||!accruals.length) break;
          lastId=next;
        }
        days++;
      }catch(e){
        errors++;
        out.ozon.push({date,status:'error',reason:String(e.message)});
      }
    }
    out.ozon.unshift({status:errors?'partial':'complete',days,rows,pages,errors});
  }else out.ozon.push({status:'missing_credentials'});
  const counts=await pool.query("SELECT source,month,SUM(jsonb_array_length(payload))::int AS rows FROM marketplace_finance_pages WHERE month BETWEEN '2026-01' AND '2026-12' GROUP BY source,month ORDER BY source,month");
  console.log(JSON.stringify({import:out,stored:counts.rows}));
}finally{await pool.end();}
