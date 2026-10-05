import fs from 'node:fs';
import pg from 'pg';

const quote=s=>'"'+s.replaceAll('"','""')+'"';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false}});
try{
  const file='/root/duisun-migration/render-snapshot.json';
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
