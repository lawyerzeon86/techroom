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

  for(let m=1;m<=lastMonth;m++){
    const month='2026-'+String(m).padStart(2,'0');
    const endDate=new Date(Date.UTC(2026,m,0));
    const to=m===lastMonth&&until.getUTCFullYear()===2026?new Date(Math.min(endDate.getTime(),until.getTime())):endDate;
    const dateTo=to.toISOString().slice(0,10);
    const client=process.env.OZON_CLIENT_ID,key=process.env.OZON_API_KEY;
    if(client&&key){
      try{
        let page=1,pages=1,rows=0;
        for(;page<=pages&&page<=200;page++){
          const data=await request('https://api-seller.ozon.ru/v3/finance/transaction/list',{'Client-Id':client,'Api-Key':key},
            {filter:{date:{from:month+'-01T00:00:00Z',to:dateTo+'T23:59:59Z'},transaction_type:'all'},page,page_size:1000});
          if(!Array.isArray(data?.result?.operations))throw Error('INVALID_RESPONSE');
          pages=Number(data.result.page_count)||0;
          await save('ozon',month,page,data.result.operations);
          rows+=data.result.operations.length;
        }
        out.ozon.push({month,status:page>pages?'complete':'page_limit',rows,pages:page-1});
      }catch(e){out.ozon.push({month,status:'error',reason:String(e.message)});}
    }else out.ozon.push({month,status:'missing_credentials'});
  }
  const counts=await pool.query("SELECT source,month,SUM(jsonb_array_length(payload))::int AS rows FROM marketplace_finance_pages WHERE month BETWEEN '2026-01' AND '2026-12' GROUP BY source,month ORDER BY source,month");
  console.log(JSON.stringify({import:out,stored:counts.rows}));
}finally{await pool.end();}
