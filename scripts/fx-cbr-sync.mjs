#!/usr/bin/env node
import pg from 'pg';
const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const args=new Set(process.argv.slice(2));
const now=new Date();
const start=args.has('--backfill')?new Date(Date.UTC(now.getUTCFullYear(),0,1)):new Date(Date.now()-14*86400000);
const end=now;
const parse=v=>Number(String(v||'').replace(/\s/g,'').replace(',','.'))||0;
function xmlRows(xml){
 const out=[];
 const re=/<Valute[^>]*>([\s\S]*?)<\/Valute>/g; let m;
 while((m=re.exec(xml))){
  const b=m[1];
  const get=t=>{const x=b.match(new RegExp('<'+t+'>([\\s\\S]*?)<\\/'+t+'>'));return x?x[1].trim():''};
  const code=get('CharCode').toUpperCase(),nominal=parse(get('Nominal'))||1,value=parse(get('Value'));
  if(/^[A-Z]{3}$/.test(code)&&value>0)out.push({code,nominal,rate:value/nominal});
 }
 return out;
}
async function ensure(){
 await pool.query(`
 CREATE TABLE IF NOT EXISTS fx_rates(
   rate_date DATE NOT NULL,
   currency_code CHAR(3) NOT NULL,
   rate_to_rub NUMERIC(20,8) NOT NULL,
   nominal INTEGER NOT NULL DEFAULT 1,
   source TEXT NOT NULL DEFAULT 'CBR',
   fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   PRIMARY KEY(rate_date,currency_code)
 )`);
}
async function one(d){
 const date=d.toISOString().slice(0,10);
 const exists=await pool.query("select 1 from fx_rates where rate_date=$1 limit 1",[date]);
 if(exists.rowCount)return {date,status:'cached'};
 const [y,m,day]=date.split('-');
 const url='https://www.cbr.ru/scripts/XML_daily.asp?date_req='+day+'/'+m+'/'+y;
 const r=await fetch(url,{headers:{'User-Agent':'DuisunFinance/1.0'},signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw new Error('CBR_'+r.status);
 const xml=await r.text(),rows=xmlRows(xml);
 if(!rows.length)throw new Error('CBR_EMPTY');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(`INSERT INTO fx_rates(rate_date,currency_code,rate_to_rub,nominal,source)
    VALUES($1,'RUB',1,1,'CBR') ON CONFLICT(rate_date,currency_code)
    DO UPDATE SET rate_to_rub=1,fetched_at=NOW()`,[date]);
  for(const x of rows)await client.query(`INSERT INTO fx_rates(rate_date,currency_code,rate_to_rub,nominal,source)
    VALUES($1,$2,$3,$4,'CBR') ON CONFLICT(rate_date,currency_code)
    DO UPDATE SET rate_to_rub=EXCLUDED.rate_to_rub,nominal=EXCLUDED.nominal,fetched_at=NOW()`,[date,x.code,x.rate,x.nominal]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 return {date,status:'fetched',currencies:rows.length+1};
}
try{
 await ensure();
 let fetched=0,cached=0,errors=0;
 for(let d=new Date(start);d<=end;d.setUTCDate(d.getUTCDate()+1)){
  try{const x=await one(d);x.status==='fetched'?fetched++:cached++}
  catch(e){errors++;console.error(JSON.stringify({date:d.toISOString().slice(0,10),error:String(e?.message||e)}))}
  await sleep(120);
 }
 const q=await pool.query("select min(rate_date) min,max(rate_date) max,count(*)::int rows,count(distinct currency_code)::int currencies from fx_rates");
 console.log(JSON.stringify({ok:errors===0,fetched,cached,errors,coverage:q.rows[0]}));
}finally{await pool.end()}
