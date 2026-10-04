import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';

const sourcePath=process.argv[2]||'/root/duisun-migration/render-snapshot.json';
const source=JSON.parse(fs.readFileSync(sourcePath,'utf8'));
if(source.version!==1||!Array.isArray(source.tables))throw new Error('Invalid snapshot');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const archive='render_archive_'+createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex').slice(0,12);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false}});
const client=await pool.connect();
const natural={products:['sku'],marketplace_product_hub:['canonical_sku'],marketplace_orders:['source','external_id'],marketplace_communications:['source','kind','external_id'],marketplace_settings:['key'],price_sheet:['sku'],marketplace_product_links:['hub_id','marketplace'],marketplace_product_rules:['source_marketplace','target_marketplace'],orders:['order_number'],marketplace_sync_runs:['started_at']};
const maps=new Map();
const report=[];
try{
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='30s'");
  await client.query('SELECT pg_advisory_xact_lock(74195021)');
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quote(archive)}`);
  for(const table of source.tables){
    if(table.count!==table.rows.length||createHash('sha256').update(JSON.stringify(table.rows)).digest('hex')!==table.sha256)throw new Error('Snapshot checksum mismatch: '+table.name);
    for(const column of table.columns)if(!/^[a-zA-Z0-9_ \[\](),]+$/.test(column.type))throw new Error('Unsupported column type');
    const full=`${quote(archive)}.${quote(table.name)}`;
    await client.query(`CREATE TABLE IF NOT EXISTS ${full} (${table.columns.map(c=>`${quote(c.name)} ${c.type}`).join(',')})`);
    const count=Number((await client.query(`SELECT count(*) FROM ${full}`)).rows[0].count);
    if(count===0)for(const row of table.rows)await client.query(`INSERT INTO ${full} SELECT * FROM json_populate_record(NULL::${full},$1::json)`,[JSON.stringify(row)]);
    const archivedCount=Number((await client.query(`SELECT count(*) FROM ${full}`)).rows[0].count);
    if(archivedCount!==table.count)throw new Error('Archive count mismatch: '+table.name);
    for(const row of table.rows){
      const conditions=table.columns.map(c=>c.type==='json'?`actual.${quote(c.name)}::jsonb IS NOT DISTINCT FROM expected.${quote(c.name)}::jsonb`:`actual.${quote(c.name)} IS NOT DISTINCT FROM expected.${quote(c.name)}`).join(' AND ');
      const verified=(await client.query(`SELECT EXISTS(SELECT 1 FROM ${full} actual CROSS JOIN json_populate_record(NULL::${full},$1::json) expected WHERE ${conditions}) AS ok`,[JSON.stringify(row)])).rows[0].ok;
      if(!verified)throw new Error('Archive value mismatch: '+table.name);
    }
  }
  // Parents precede all known foreign-key dependants.
  const order=['products','marketplace_product_hub','orders','marketplace_orders','marketplace_communications','marketplace_settings','marketplace_product_rules','price_sheet','marketplace_product_links','order_items'];
  const tables=[...source.tables].sort((a,b)=>(order.includes(a.name)?order.indexOf(a.name):100)-(order.includes(b.name)?order.indexOf(b.name):100));
  for(const table of tables){
    const full=`public.${quote(table.name)}`;
    const existed=Boolean((await client.query('SELECT to_regclass($1) AS name',[full])).rows[0].name);
    if(!existed){
      await client.query(`CREATE TABLE ${full} (${table.columns.map(c=>`${quote(c.name)} ${c.type}${c.not_null?' NOT NULL':''}`).join(',')})`);
      for(const c of table.columns){
        if(c.default_value?.startsWith('nextval(')){
          const seq=table.name+'_'+c.name+'_seq';
          await client.query(`CREATE SEQUENCE IF NOT EXISTS public.${quote(seq)}`);
          await client.query(`ALTER TABLE ${full} ALTER COLUMN ${quote(c.name)} SET DEFAULT nextval('public.${seq}'::regclass)`);
          await client.query(`ALTER SEQUENCE public.${quote(seq)} OWNED BY ${full}.${quote(c.name)}`);
        }
      }
      for(const c of table.constraints.filter(c=>['p','u','c'].includes(c.kind)))await client.query(`ALTER TABLE ${full} ADD CONSTRAINT ${quote(c.name)} ${c.definition}`);
    }
    const destColumns=(await client.query(`SELECT column_name,data_type,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,[table.name])).rows;
    const available=new Set(destColumns.map(c=>c.column_name));
    for(const c of table.columns)if(!available.has(c.name)){await client.query(`ALTER TABLE ${full} ADD COLUMN ${quote(c.name)} ${c.type}`);available.add(c.name)}
    const pk=table.constraints.find(c=>c.kind==='p')?.definition.match(/PRIMARY KEY \(([^)]+)\)/)?.[1].split(',').map(s=>s.trim().replaceAll('"',''))||[];
    const unique=table.constraints.find(c=>c.kind==='u')?.definition.match(/UNIQUE \(([^)]+)\)/)?.[1].split(',').map(s=>s.trim().replaceAll('"',''));
    const keys=natural[table.name]||unique||pk;
    const idMap=new Map();maps.set(table.name,idMap);
    let inserted=0,matched=0;
    for(const original of table.rows){
      const row={...original};
      for(const c of table.constraints.filter(c=>c.kind==='f')){
        const fk=c.definition.match(/FOREIGN KEY \(([^)]+)\) REFERENCES (?:public\.)?([^ (]+)\(([^)]+)\)/);
        if(!fk)throw new Error('Unsupported foreign key');
        const column=fk[1].replaceAll('"',''),parent=fk[2].replaceAll('"','');
        if(row[column]!=null){const mapped=maps.get(parent)?.get(String(row[column]));if(mapped==null)throw new Error('Unmapped foreign key '+table.name+'.'+column);row[column]=mapped}
      }
      if(!keys.length&&table.rows.length)throw new Error('No stable key: '+table.name);
      const where=keys.map((key,i)=>`${quote(key)} IS NOT DISTINCT FROM $${i+1}`).join(' AND ');
      const values=keys.map(key=>row[key]);
      const hit=(await client.query(`SELECT * FROM ${full} WHERE ${where} LIMIT 1`,values)).rows[0];
      let destination=hit;
      if(hit){
        matched++;
        // Preserve live prices/stock; restore missing accounting inputs.
        if(table.name==='price_sheet')for(const c of ['cost_price','variable_cost','min_price'])if(Number(hit[c])===0&&Number(row[c])>0)await client.query(`UPDATE ${full} SET ${quote(c)}=$1 WHERE sku=$2`,[row[c],row.sku]);
      }else{
        const cols=table.columns.map(c=>c.name).filter(c=>available.has(c)&&!(c==='id'&&existed&&destColumns.find(d=>d.column_name===c)?.column_default));
        const params=cols.map(c=>{const type=table.columns.find(x=>x.name===c).type;return type==='json'||type==='jsonb'?JSON.stringify(row[c]):row[c]});
        destination=(await client.query(`INSERT INTO ${full} (${cols.map(quote).join(',')}) VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,params)).rows[0];inserted++;
      }
      if(original.id!=null)idMap.set(String(original.id),destination.id);
    }
    // Repair sequences even on newly restored tables.
    for(const c of table.columns){
      const seq=(await client.query('SELECT pg_get_serial_sequence($1,$2) AS seq',[full,c.name])).rows[0].seq;
      if(seq){const max=(await client.query(`SELECT max(${quote(c.name)}) AS n FROM ${full}`)).rows[0].n;if(max!=null)await client.query('SELECT setval($1::regclass,$2,true)',[seq,max])}
    }
    report.push({table:table.name,source:table.count,archived:table.count,inserted,matched});
  }
  await client.query('COMMIT');
  const uploads='/var/www/duisun/public/uploads';
  for(const file of source.files||[]){
    const dest=path.resolve(uploads,file.path);
    if(!dest.startsWith(uploads+'/'))throw new Error('Invalid upload path');
    const bytes=Buffer.from(file.base64,'base64');
    if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('Upload checksum');
    fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest))fs.writeFileSync(dest,bytes);
  }
  const envPath='/root/duisun-integrations.env';
  const existing=fs.existsSync(envPath)?fs.readFileSync(envPath,'utf8'):'';
  fs.writeFileSync(envPath+'.before-migration',existing,{mode:0o600});
  const names=new Set(existing.split('\n').map(line=>line.split('=')[0]));
  const ignored=/(_WEBAPP_URL|_STORE_URL|_RETURN_URL)$|^SYNC_/;
  const added=[];let extra='';
  for(const [key,value] of Object.entries(source.environment||{}))if(!names.has(key)&&!ignored.test(key)){
    if(!/^[A-Z0-9_]+$/.test(key))throw new Error('Invalid environment key');
    extra+=key+"='"+String(value).replaceAll("'","'\\''")+"'\n";added.push(key);
  }
  fs.writeFileSync(envPath,existing.replace(/\n?$/,'\n')+extra,{mode:0o600});
  const result={ok:true,archive,exportedAt:source.exportedAt,tables:report,environmentAdded:added,files:(source.files||[]).length};
  fs.writeFileSync('/root/duisun-migration/verified-report.json',JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify(result));
}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
finally{client.release();await pool.end()}
