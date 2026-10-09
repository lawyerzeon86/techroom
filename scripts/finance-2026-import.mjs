#!/usr/bin/env node
import pg from 'pg';
const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=new Date();
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
      const retry=Math.max(61000,Number(r.headers.get('retry-after')||0)*1000);
      await sleep(retry);continue;
    }
    if(!r.ok)throw Error('HTTP_'+r.status+':'+(await r.text()).slice(0,300));
    return r.json();
  }
}
const monthOf=x=>{
  const d=String(x?.saleDt||x?.orderDt||x?.rrDate||x?.dateFrom||x?.createDate||'').slice(0,7);
  return /^2026-(0[1-9]|1[0-2])$/.test(d)?d:null;
};
try{
  await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_finance_pages (
    source TEXT NOT NULL,month CHAR(7) NOT NULL,page INTEGER NOT NULL,
    payload JSONB NOT NULL,fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(source,month,page))`);
  await pool.query("DELETE FROM marketplace_finance_pages WHERE source IN ('wildberries','wildberries_reports','ozon') AND month BETWEEN '2026-01' AND '2026-12'");
  const end=(until.getUTCFullYear()===2026?until:new Date(Date.UTC(2026,11,31,23,59,59))).toISOString().slice(0,10);

  const wb=process.env.WB_FINANCE_TOKEN||process.env.WB_API_TOKEN;
  if(wb){
    const headers={Authorization:wb};
    try{
      let cursor=0,page=0,total=0;
      for(let p=0;p<20;p++){
        if(p>0)await sleep(61000);
        const data=await request('https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed',headers,{dateFrom:'2026-01-01',dateTo:end,limit:100000,rrdId:cursor});
        if(!Array.isArray(data))throw Error('WB_DETAIL_INVALID');
        if(!data.length){out.wildberries.push({details:'complete',pages:page,rows:total});break;}
        const next=Number(data.at(-1)?.rrdId??0);if(next<=cursor)throw Error('WB_CURSOR');cursor=next;
        const groups=new Map();
        for(const row of data){const m=monthOf(row);if(!m)continue;if(!groups.has(m))groups.set(m,[]);groups.get(m).push(row);}
        for(const [m,rows] of groups)await save('wildberries',m,page,rows);
        page++;total+=data.length;
        if(data.length<100000){out.wildberries.push({details:'complete',pages:page,rows:total});break;}
      }
      await sleep(61000);
      let offset=0,listPage=0,listTotal=0;
      for(let p=0;p<20;p++){
        const data=await request('https://finance-api.wildberries.ru/api/finance/v1/sales-reports/list',headers,{dateFrom:'2026-01-01',dateTo:end,limit:1000,offset,period:'daily'});
        const rows=Array.isArray(data)?data:(Array.isArray(data?.reports)?data.reports:[]);
        if(!rows.length){out.wildberries.push({reports:'complete',pages:listPage,rows:listTotal});break;}
        const groups=new Map();
        for(const row of rows){const m=String(row.dateFrom||row.createDate||'').slice(0,7);if(!/^2026-(0[1-9]|1[0-2])$/.test(m))continue;if(!groups.has(m))groups.set(m,[]);groups.get(m).push(row);}
        for(const [m,items] of groups)await save('wildberries_reports',m,listPage,items);
        listPage++;listTotal+=rows.length;offset+=rows.length;
        if(rows.length<1000){out.wildberries.push({reports:'complete',pages:listPage,rows:listTotal});break;}
        await sleep(61000);
      }
    }catch(e){out.wildberries.push({status:'error',reason:String(e.message)});}
  }else out.wildberries.push({status:'missing_token'});

  const client=process.env.OZON_CLIENT_ID,key=process.env.OZON_API_KEY;
  if(client&&key){
    const headers={'Client-Id':client,'Api-Key':key};
    const start=new Date(Date.UTC(2026,0,1)),finish=until.getUTCFullYear()===2026?until:new Date(Date.UTC(2026,11,31));
    const dates=[];for(let d=new Date(start);d<=finish;d.setUTCDate(d.getUTCDate()+1))dates.push(new Date(d));
    let days=0,rows=0,pages=0,errors=0;
    async function oneDay(d){
      const date=d.toISOString().slice(0,10),month=date.slice(0,7),dayIndex=Math.floor((d-start)/86400000);
      let lastId='',n=0,p=0;
      try{
        for(let part=0;part<100;part++){
          const data=await request('https://api-seller.ozon.ru/v1/finance/accrual/by-day',headers,{date,last_id:lastId});
          const items=Array.isArray(data?.accruals)?data.accruals:(Array.isArray(data?.result?.accruals)?data.result.accruals:[]);
          const next=String(data?.last_id??data?.result?.last_id??'');
          if(items.length)await save('ozon',month,dayIndex*100+part,items);
          n+=items.length;p++;
          if(!next||next===lastId||!items.length)break;lastId=next;
        }
        return {ok:true,n,p};
      }catch(e){out.ozon.push({date,status:'error',reason:String(e.message)});return {ok:false,n,p};}
    }
    for(let i=0;i<dates.length;i+=6){const batch=await Promise.all(dates.slice(i,i+6).map(oneDay));for(const x of batch){rows+=x.n;pages+=x.p;x.ok?days++:errors++;}await sleep(150);}
    out.ozon.unshift({status:errors?'partial':'complete',days,rows,pages,errors});
  }else out.ozon.push({status:'missing_credentials'});
  const counts=await pool.query("SELECT source,month,SUM(jsonb_array_length(payload))::int rows FROM marketplace_finance_pages WHERE month BETWEEN '2026-01' AND '2026-12' GROUP BY source,month ORDER BY source,month");
  console.log(JSON.stringify({import:out,stored:counts.rows}));
}finally{await pool.end();}
