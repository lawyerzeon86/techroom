#!/usr/bin/env node
import pg from 'pg';
const {Pool}=pg;

const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}
});

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const now=new Date();
const currentYear=now.getUTCFullYear();
const arg=(name,fallback)=>{
  const p=process.argv.find(x=>x.startsWith('--'+name+'='));
  return p?Number(p.split('=')[1]):fallback;
};
const fromYear=Math.max(2022,arg('from-year',2022));
const toYear=Math.min(currentYear,arg('to-year',currentYear));
const out={fromYear,toYear,wildberries:[],ozon:[],stored:[],errors:[]};

async function ensure(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketplace_finance_pages(
      source TEXT NOT NULL,
      month CHAR(7) NOT NULL,
      page INTEGER NOT NULL,
      payload JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(source,month,page)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS finance_import_coverage(
      source TEXT NOT NULL,
      year INTEGER NOT NULL,
      status TEXT NOT NULL,
      date_from DATE,
      date_to DATE,
      rows_count INTEGER NOT NULL DEFAULT 0,
      pages_count INTEGER NOT NULL DEFAULT 0,
      errors_count INTEGER NOT NULL DEFAULT 0,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(source,year)
    )
  `);
}

async function markCoverage(source,year,status,meta={}){
  await pool.query(`
    INSERT INTO finance_import_coverage(source,year,status,date_from,date_to,rows_count,pages_count,errors_count,details,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())
    ON CONFLICT(source,year) DO UPDATE SET
      status=EXCLUDED.status,
      date_from=EXCLUDED.date_from,
      date_to=EXCLUDED.date_to,
      rows_count=EXCLUDED.rows_count,
      pages_count=EXCLUDED.pages_count,
      errors_count=EXCLUDED.errors_count,
      details=EXCLUDED.details,
      updated_at=NOW()
  `,[
    source,year,status,meta.start||null,meta.end||null,
    Number(meta.rows??meta.detailRows??0)||0,
    Number(meta.pages??meta.detailPages??0)||0,
    Number(meta.errors??0)||0,
    JSON.stringify(meta)
  ]);
}

async function request(url,headers,body){
  for(let attempt=0;attempt<5;attempt++){
    const r=await fetch(url,{
      method:'POST',
      headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify(body),
      signal:AbortSignal.timeout(60000)
    });
    if(r.status===204)return [];
    if(r.status===429||r.status===503){
      if(attempt===4)throw new Error('HTTP_'+r.status);
      const retry=Math.max(61000,Number(r.headers.get('retry-after')||0)*1000);
      await sleep(retry);continue;
    }
    if(!r.ok)throw new Error('HTTP_'+r.status+':'+(await r.text()).slice(0,500));
    return r.json();
  }
  return [];
}

function validMonth(year,m){
  return new RegExp('^'+year+'-(0[1-9]|1[0-2])$').test(m);
}
function monthOf(year,x){
  const m=String(x?.saleDt||x?.orderDt||x?.rrDate||x?.dateFrom||x?.createDate||'').slice(0,7);
  return validMonth(year,m)?m:null;
}
function groupByMonth(year,rows){
  const g=new Map();
  for(const row of rows){
    const m=monthOf(year,row);
    if(!m)continue;
    if(!g.has(m))g.set(m,[]);
    g.get(m).push(row);
  }
  return g;
}
async function replaceYear(source,year,groups){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query("DELETE FROM marketplace_finance_pages WHERE source=$1 AND month LIKE $2",[source,String(year)+'-%']);
    for(const [month,rows] of groups){
      const chunk=5000;
      for(let i=0,page=0;i<rows.length;i+=chunk,page++){
        await client.query(`
          INSERT INTO marketplace_finance_pages(source,month,page,payload,fetched_at)
          VALUES($1,$2,$3,$4::jsonb,NOW())
        `,[source,month,page,JSON.stringify(rows.slice(i,i+chunk))]);
      }
    }
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}

async function importWb(year){
  if(year<2024){
    const r={year,status:'source_unavailable',reason:'WB finance detailed history starts 2024-01-29'};
    await markCoverage('wildberries',year,'source_unavailable',r);
    await markCoverage('wildberries_reports',year,'source_unavailable',{...r,reason:'WB finance report list starts 2025-01-01'});
    return r;
  }
  const token=process.env.WB_FINANCE_TOKEN||process.env.WB_API_TOKEN;
  if(!token){const r={year,status:'missing_token'};await markCoverage('wildberries',year,r.status,r);return r}
  const headers={Authorization:token};
  const start=year===2024?'2024-01-29':year+'-01-01';
  const end=year===currentYear?now.toISOString().slice(0,10):year+'-12-31';
  let cursor=0,total=0,pages=0;
  const all=[];
  for(let p=0;p<50;p++){
    if(p>0)await sleep(61000);
    const data=await request(
      'https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed',
      headers,
      {dateFrom:start,dateTo:end,limit:100000,rrdId:cursor}
    );
    if(!Array.isArray(data))throw new Error('WB_DETAIL_INVALID');
    if(!data.length)break;
    all.push(...data);total+=data.length;pages++;
    const next=Number(data.at(-1)?.rrdId??data.at(-1)?.rrd_id??0);
    if(!next||next<=cursor||data.length<100000)break;
    cursor=next;
  }
  await replaceYear('wildberries',year,groupByMonth(year,all));

  let reportRows=[];
  if(year>=2025){
    await sleep(61000);
    let offset=0;
    for(let p=0;p<50;p++){
      const data=await request(
        'https://finance-api.wildberries.ru/api/finance/v1/sales-reports/list',
        headers,
        {dateFrom:start,dateTo:end,limit:1000,offset,period:'daily'}
      );
      const rows=Array.isArray(data)?data:(Array.isArray(data?.reports)?data.reports:[]);
      if(!rows.length)break;
      reportRows.push(...rows);
      offset+=rows.length;
      if(rows.length<1000)break;
      await sleep(61000);
    }
    await replaceYear('wildberries_reports',year,groupByMonth(year,reportRows));
  }
  const status=year===2024?'complete_available_range':'complete';
  const result={year,status,start,end,detailRows:total,detailPages:pages,reportRows:reportRows.length};
  await markCoverage('wildberries',year,status,{...result,rows:total,pages});
  await markCoverage('wildberries_reports',year,year>=2025?'complete':'source_unavailable',{...result,rows:reportRows.length,pages:0});
  return result;
}

async function importOzon(year){
  const client=process.env.OZON_CLIENT_ID,key=process.env.OZON_API_KEY;
  if(!client||!key){const r={year,status:'missing_credentials'};await markCoverage('ozon',year,r.status,r);return r}
  const headers={'Client-Id':client,'Api-Key':key};
  const start=new Date(Date.UTC(year,0,1));
  const finish=year===currentYear?now:new Date(Date.UTC(year,11,31));
  const dates=[];
  for(let d=new Date(start);d<=finish;d.setUTCDate(d.getUTCDate()+1))dates.push(new Date(d));
  const all=[];
  let days=0,pages=0,errors=0;

  async function oneDay(d){
    const date=d.toISOString().slice(0,10);
    let lastId='',n=0,p=0;
    try{
      for(let part=0;part<100;part++){
        const data=await request(
          'https://api-seller.ozon.ru/v1/finance/accrual/by-day',
          headers,
          {date,last_id:lastId}
        );
        const items=Array.isArray(data?.accruals)?data.accruals:(Array.isArray(data?.result?.accruals)?data.result.accruals:[]);
        const next=String(data?.last_id??data?.result?.last_id??'');
        if(items.length)all.push(...items.map(x=>({...x,__duisun_date:date})));
        n+=items.length;p++;
        if(!next||next===lastId||!items.length)break;
        lastId=next;
      }
      return {ok:true,n,p};
    }catch(e){
      return {ok:false,n,p,error:String(e?.message||e),date};
    }
  }

  for(let i=0;i<dates.length;i+=6){
    const batch=await Promise.all(dates.slice(i,i+6).map(oneDay));
    for(const x of batch){pages+=x.p;if(x.ok)days++;else{errors++;out.errors.push('OZON:'+year+':'+x.date+':'+x.error)}}
    await sleep(150);
  }
  if(errors)throw new Error('OZON_'+year+'_ERRORS_'+errors);

  const groups=new Map();
  for(const x of all){
    const m=String(x.__duisun_date||'').slice(0,7);
    if(!validMonth(year,m))continue;
    if(!groups.has(m))groups.set(m,[]);
    const copy={...x};delete copy.__duisun_date;
    groups.get(m).push(copy);
  }
  await replaceYear('ozon',year,groups);
  const result={year,status:'complete',days,rows:all.length,pages,errors:0,start:start.toISOString().slice(0,10),end:finish.toISOString().slice(0,10)};
  await markCoverage('ozon',year,'complete',result);
  return result;
}

try{
  await ensure();
  for(let year=fromYear;year<=toYear;year++){
    try{out.wildberries.push(await importWb(year))}
    catch(e){const reason=String(e?.message||e);out.wildberries.push({year,status:'error',reason});out.errors.push('WB:'+year+':'+reason);await markCoverage('wildberries',year,'error',{errors:1,reason})}
    try{out.ozon.push(await importOzon(year))}
    catch(e){const reason=String(e?.message||e);out.ozon.push({year,status:'error',reason});out.errors.push('OZON:'+year+':'+reason);await markCoverage('ozon',year,'error',{errors:1,reason})}
  }
  const counts=await pool.query(`
    SELECT source,btrim(month) month_key,coalesce(sum(jsonb_array_length(payload)),0)::int rows
    FROM marketplace_finance_pages
    WHERE substring(btrim(month),1,4)::int BETWEEN $1 AND $2
    GROUP BY source,month
    ORDER BY source,month
  `,[fromYear,toYear]);
  out.stored=counts.rows;
  console.log(JSON.stringify({ok:out.errors.length===0,...out},null,2));
}finally{
  await pool.end();
}

// history-run-2
