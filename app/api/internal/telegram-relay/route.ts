import { NextResponse } from 'next/server';
import { ensureSchema, getPool } from '../../../../lib/db';
export const runtime='nodejs'; export const dynamic='force-dynamic';
async function tg(method:string,body?:Record<string,string>){
  const token=process.env.TELEGRAM_BOT_TOKEN?.trim(); if(!token)throw new Error('BOT_NOT_CONFIGURED');
  const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/x-www-form-urlencoded'}:undefined,body:body?new URLSearchParams(body):undefined,cache:'no-store'});
  const j=await r.json(); if(!j?.ok)throw new Error(String(j?.description||`TG_${r.status}`)); return j.result;
}
async function chat(){await ensureSchema();const p=getPool();await p.query(`CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);const r=await p.query(`SELECT value FROM app_settings WHERE key='telegram_admin_chat_id' LIMIT 1`);return String(r.rows[0]?.value||'');}
export async function POST(request:Request){
  if(request.headers.get('x-relay-secret')!==process.env.TELEGRAM_RELAY_SECRET)return NextResponse.json({ok:false},{status:401});
  try{
    const body=await request.json().catch(()=>({}));
    if(body?.action==='bind'){
      await tg('deleteWebhook',{drop_pending_updates:'false'}); const updates:any[]=await tg('getUpdates')||[];
      const hit=[...updates].reverse().find((u:any)=>String(u?.message?.text||'').trim()==='/bindadmin'&&u?.message?.chat?.type==='private');
      if(!hit)return NextResponse.json({ok:false,error:'NO_BIND_MESSAGE'},{status:409});
      await ensureSchema();const p=getPool();await p.query(`CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);await p.query(`INSERT INTO app_settings(key,value) VALUES('telegram_admin_chat_id',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,[String(hit.message.chat.id)]);
      const ws=process.env.TELEGRAM_WEBHOOK_SECRET?.trim(); if(ws)await tg('setWebhook',{url:'https://techroom-main.onrender.com/api/telegram/webhook',secret_token:ws,drop_pending_updates:'false'});
      await tg('sendMessage',{chat_id:String(hit.message.chat.id),text:'✅ Duisun: чат привязан для FBS-уведомлений Wildberries.'});
      return NextResponse.json({ok:true,bound:true});
    }
    const chatId=await chat(); if(!chatId)return NextResponse.json({ok:false,error:'ADMIN_CHAT_NOT_BOUND'},{status:409});
    await tg('sendMessage',{chat_id:chatId,text:String(body?.text||''),parse_mode:'HTML',disable_web_page_preview:'true'});
    return NextResponse.json({ok:true});
  }catch(e:any){return NextResponse.json({ok:false,error:String(e?.message||e)},{status:500});}
}
