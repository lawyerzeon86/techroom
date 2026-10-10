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
    SELECT source,btrim("month") AS month_key,count(*)::int AS page_count,
           coalesce(sum(jsonb_array_length(payload)),0)::int AS row_count,
           max(fetched_at) AS fetched_at
    FROM marketplace_finance_pages
    GROUP BY source,"month"
    ORDER BY source,"month"
  `);
  out.db.financePages=counts.rows;

  try{
    const coverage=await c.query(`
      SELECT source,year,status,date_from,date_to,rows_count,pages_count,errors_count,details,updated_at
      FROM finance_import_coverage
      ORDER BY year,source
    `);
    out.db.coverage=coverage.rows;
    for(const r of coverage.rows){
      if(!['complete','complete_available_range','not_applicable','source_unavailable'].includes(String(r.status))){
        out.issues.push('COVERAGE:'+r.source+':'+r.year+':'+r.status);
      }
    }
  }catch(e){
    out.db.coverageError=e.message;
    out.issues.push('FINANCE_IMPORT_COVERAGE_MISSING');
  }

  const ps=await c.query(`
    SELECT count(*)::int total,
           count(*) filter(where cost_price>0)::int with_cost,
           count(*) filter(where cost_price=0)::int without_cost
    FROM price_sheet
  `);
  out.db.costCoverage=ps.rows[0];
  if(Number(ps.rows[0]?.without_cost||0)>0)out.issues.push('COST_PRICE_INCOMPLETE:'+ps.rows[0].without_cost);

  try{
    const fx=await c.query(`
      SELECT btrim(currency_code) currency_code,count(distinct rate_date)::int days,min(rate_date) first_date,max(rate_date) last_date
      FROM fx_rates GROUP BY 1 ORDER BY 1
    `);
    out.db.fxRates=fx.rows;
    const rub=fx.rows.find(x=>String(x.currency_code).trim()==='RUB');
    if(!rub)out.issues.push('FX_RUB_MISSING');
  }catch(e){out.db.fxRatesError=e.message;out.issues.push('FX_RATES_TABLE_OR_QUERY_ERROR')}

  const avito=counts.rows.filter(x=>x.source==='avito');
  out.db.avito={months:avito.length,rows:avito.reduce((s,x)=>s+Number(x.row_count||0),0),lastFetched:avito.map(x=>x.fetched_at).filter(Boolean).sort().at(-1)||null};
  if(!avito.length)out.issues.push('AVITO:NO_DATA');

  await c.end();
}catch(e){out.issues.push('DB_ERROR:'+e.message)}
console.log(JSON.stringify(out,null,2));
