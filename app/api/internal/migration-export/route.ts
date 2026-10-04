import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPool } from '../../../../lib/db';
import { verifyGitHubActionsToken } from '../../../../lib/github-oidc';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';

// Explicitly enabled only on the source during migration; automatically expires.
export async function POST(request:Request){
  const expires=Date.parse(process.env.MIGRATION_EXPORT_UNTIL||'');
  if(!Number.isFinite(expires)||expires<Date.now())return NextResponse.json({error:'Not found'},{status:404});
  const token=request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]||'';
  if(!token||!await verifyGitHubActionsToken(token,'migration').catch(()=>false))return NextResponse.json({error:'Unauthorized'},{status:401});
  const client=await getPool().connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='60s'");
    const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    const exported:any[]=[];
    for(const {tablename} of tables){
      const columns=(await client.query(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,[tablename])).rows;
      const constraints=(await client.query(`SELECT con.conname AS name,con.contype AS kind,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1`,[tablename])).rows;
      const count=Number((await client.query(`SELECT count(*) FROM public.${quote(tablename)}`)).rows[0].count);
      if(count>100000)throw new Error('TABLE_EXPORT_LIMIT');
      const rows=(await client.query(`SELECT row_to_json(t) AS row FROM public.${quote(tablename)} t`)).rows.map(x=>x.row);
      const sha256=createHash('sha256').update(JSON.stringify(rows)).digest('hex');
      exported.push({name:tablename,columns,constraints,count,sha256,rows});
    }
    await client.query('COMMIT');
    const files:any[]=[];
    const root=path.join(process.cwd(),'public','uploads');
    async function walk(dir:string){
      const entries=await fs.readdir(dir,{withFileTypes:true}).catch(()=>[]);
      for(const entry of entries){
        const file=path.join(dir,entry.name);
        if(entry.isDirectory())await walk(file);
        else if(entry.isFile()){
          const data=await fs.readFile(file);
          files.push({path:path.relative(root,file),base64:data.toString('base64'),sha256:createHash('sha256').update(data).digest('hex')});
        }
      }
    }
    await walk(root);
    const keys=/^(WB_|OZON_|AVITO_|YANDEX_MARKET_|VK_|TELEGRAM_|MAX_|WHATSAPP_|YOOKASSA_|OPENAI_|SMTP_|EMAIL_|NOTIFY_|PRICE_GUARD_|SYNC_)/;
    const environment=Object.fromEntries(Object.entries(process.env).filter(([key,value])=>keys.test(key)&&value));
    const result={version:1,exportedAt:new Date().toISOString(),tables:exported,files,environment};
    const json=JSON.stringify(result);
    if(Buffer.byteLength(json)>100*1024*1024)throw new Error('EXPORT_SIZE_LIMIT');
    return new Response(json,{headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }catch{
    await client.query('ROLLBACK').catch(()=>{});
    return NextResponse.json({error:'Export failed'},{status:500});
  }finally{client.release()}
}
