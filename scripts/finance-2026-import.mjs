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
    const isWb=url.includes('finance-api.wildberries.ru');
    const endpoint=isWb?url+'?'+new URLSearchParams(Object.entries(body).map(([k,v])=>[k,String(v)])):url;
    const r=await fetch(endpoint,{method:isWb?'GET':'POST',headers:{...headers,...(isWb?{}:{'Content-Type':'application/json'})},...(isWb?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(50000)});
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
  for(let m=1;m<=lastMonth;m++){
    const month='2026-'+String(m).padStart(2,'0');
    const endDate=new Date(Date.UTC(2026,m,0));
    const to=m===lastMonth&&until.getUTCFullYear()===2026?new Date(Math.min(endDate.getTime(),until.getTime())):endDate;
    const dateTo=to.toISOString().slice(0,10);
    const wb=process.env.WB_FINANCE_TOKEN||process.env.WB_API_TOKEN;
    if(wb){
      try {
        const existing=await pool.query("SELECT page,payload FROM marketplace_finance_pages WHERE source='wildberries' AND month=$1 ORDER BY page DESC LIMIT 1",[month]);
        let page=existing.rows.length?Number(existing.rows[0].page)+1:0;
        let prev=existing.rows[0]?.payload;
        if(Array.isArray(prev)&&prev.length===0){out.wildberries.push({month,status:'already_complete'});}
        else{
          let cursor=Array.isArray(prev)&&prev.length?Number(prev.at(-1).rrdId??prev.at(-1).rrd_id??0):0;
          // One request/minute seller limit. A max of 20 pages per month guards against loops.
          for(let p=0;p<20;p++){
            if(m!==1||p!==0)await sleep(61000);
            const data=await request('https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed',{Authorization:wb},{dateFrom:month+'-01',dateTo,limit:100000,rrdId:cursor});
            if(!Array.isArray(data))throw Error('INVALID_RESPONSE');
            if(data.length){
              const next=Number(data.at(-1).rrdId??data.at(-1).rrd_id??0);
              if(next<=cursor)throw Error('INVALID_CURSOR');
              cursor=next;
            }
            await save('wildberries',month,page++,data);
            if(!data.length){out.wildberries.push({month,status:'complete',pages:page});break;}
            if(p===19)out.wildberries.push({month,status:'page_limit',pages:page});
          }
        }
      }catch(e){out.wildberries.push({month,status:'error',reason:String(e.message)});}
    }else out.wildberries.push({month,status:'missing_token'});
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
