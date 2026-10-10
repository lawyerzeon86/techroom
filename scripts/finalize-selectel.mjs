import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const quote=s=>'"'+s.replaceAll('"','""')+'"';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false}});
try{
  const file='/root/duisun-migration/source-snapshot.json';
  if(fs.existsSync(file)){
    const snapshot=JSON.parse(fs.readFileSync(file,'utf8'));
    for(const table of snapshot.tables){
      for(const col of table.columns){
        if(!col.default_value||col.default_value.startsWith('nextval('))continue;
        const dest=(await pool.query(`SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,[table.name,col.name])).rows[0];
        if(dest&&dest.column_default==null){
          // Only PostgreSQL scalar defaults, never arbitrary expressions/functions.
          if(!/^(now\(\)|CURRENT_TIMESTAMP|true|false|-?\d+(\.\d+)?|'(?:[^']|'')*'::[a-z0-9_ ]+)$/.test(col.default_value))throw new Error('Unsupported default: '+table.name+'.'+col.name);
          await pool.query(`ALTER TABLE public.${quote(table.name)} ALTER COLUMN ${quote(col.name)} SET DEFAULT ${col.default_value}`);
        }
      }
    }
  }
  console.log('Historical table defaults verified');
}finally{await pool.end()}


const historySentinel='/root/duisun-finance-history-bootstrap.done';
if(!fs.existsSync(historySentinel)){
  const run=(args,logFile)=>{
    const r=spawnSync(process.execPath,args,{cwd:'/var/www/duisun',env:process.env,encoding:'utf8',timeout:45*60*1000,maxBuffer:16*1024*1024});
    fs.writeFileSync(logFile,(r.stdout||'')+(r.stderr?'\nSTDERR\n'+r.stderr:''));
    if(r.error)throw r.error;
    if(r.status!==0)throw new Error(args.join(' ')+' exited '+r.status);
    return r.stdout||'';
  };

  console.log('Running one-time historical finance bootstrap...');
  const historyOut=run(['scripts/finance-history-import.mjs','--from-year=2024'],'/var/log/duisun-finance-history-last.json');
  let historyJson=null;
  try{historyJson=JSON.parse(historyOut)}catch{}
  if(historyJson?.ok!==true)throw new Error('Historical finance import incomplete');

  const fxOut=run(['scripts/fx-cbr-sync.mjs','--backfill','--from-year=2024'],'/var/log/duisun-fx-backfill-last.json');
  const fxLines=fxOut.trim().split('\n').filter(Boolean);
  let fxJson=null;
  try{fxJson=JSON.parse(fxLines.at(-1)||'{}')}catch{}
  if(fxJson?.ok!==true)throw new Error('FX backfill incomplete');

  fs.writeFileSync(historySentinel,new Date().toISOString()+'\n');
  console.log('Historical finance bootstrap completed');
}
