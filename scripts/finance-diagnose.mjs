#!/usr/bin/env node
import fs from 'node:fs';
import pg from 'pg';
const {Client}=pg;
const out={generatedAt:new Date().toISOString(),sync:null,db:{},issues:[]};
try{
  const p='/var/log/duisun-finance-sync-last.json';
  if(fs.existsSync(p)){
    try{out.sync=JSON.parse(fs.readFileSync(p,'utf8'))}
    catch(e){out.issues.push('SYNC_LOG_INVALID_JSON:'+e.message)}
  }else out.issues.push('SYNC_LOG_MISSING');

  const c=new Client({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}});
  await c.connect();
  const counts=await c.query(`
    SELECT source,btrim(month) month,count(*)::int pages,
           coalesce(sum(jsonb_array_length(payload)),0)::int rows,
           max(fetched_at) fetched_at
    FROM marketplace_finance_pages
    WHERE month LIKE '2026-%'
    GROUP BY source,month
    ORDER BY source,month
  `);
  out.db.financePages=counts.rows;

  const expected={wildberries:[1,2,3,4,5,6,7,8,9,10],wildberries_reports:[1,2,3,4,5,6,7,8,9,10],ozon:[8,9,10]};
  for(const [s,ms] of Object.entries(expected)){
    const rows=counts.rows.filter(x=>x.source===s);
    if(!rows.length)out.issues.push(s.toUpperCase()+':NO_DATA');
    const months=new Set(rows.map(x=>x.month));
    for(const m of ms){
      const mm='2026-'+String(m).padStart(2,'0');
      if(!months.has(mm))out.issues.push(s.toUpperCase()+':MISSING_MONTH:'+mm);
    }
  }

  const ps=await c.query(`
    SELECT count(*)::int total,
           count(*) filter(where cost_price>0)::int with_cost,
           count(*) filter(where cost_price=0)::int without_cost
    FROM price_sheet
  `);
  out.db.costCoverage=ps.rows[0];

  try{
    const fx=await c.query(`
      SELECT btrim(currency_code) currency_code,count(*)::int days,min(rate_date) first_date,max(rate_date) last_date
      FROM fx_rates GROUP BY 1 ORDER BY 1
    `);
    out.db.fxRates=fx.rows;
  }catch(e){out.db.fxRatesError=e.message;out.issues.push('FX_RATES_TABLE_OR_QUERY_ERROR')}

  await c.end();
}catch(e){out.issues.push('DB_ERROR:'+e.message)}
console.log(JSON.stringify(out,null,2));

// completeness-trigger
