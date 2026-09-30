import { NextResponse } from 'next/server';
import { ensureSchema, getPool } from '../../../../lib/db';
import { sendTelegramMessage } from '../../../../lib/telegram';
export const runtime='nodejs'; export const dynamic='force-dynamic';
async function tg(method:string,body?:Record<string,string>){
  const token=process.env.TELEGRAM_BOT_TOKEN?.trim(); if(!token)throw new Error('BOT_NOT_CONFIGURED');
  const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/x-www-form-urlencoded'}:undefined,body:body?new URLSearchParams(body):undefined,cache:'no-store'});
  const j=await r.json(); if(!j?.ok)throw new Error(String(j?.description||`TG_${r.status}`)); return j.result;
}
export async function POST(request:Request){
  if(request.headers.get('x-cron-secret')!==process.env.CRON_SYNC_SECRET)return NextResponse.json({ok:false},{status:401});
  try{
    await tg('deleteWebhook',{drop_pending_updates:'false'});
    const updates:any[]=await tg('getUpdates')||[];
    const bind=[...updates].reverse().find((u:any)=>String(u?.message?.text||'').trim()==='/bindadmin'&&u?.message?.chat?.type==='private');
    if(!bind)return NextResponse.json({ok:false,error:'NO_BIND_MESSAGE'},{status:409});
    const chatId=String(bind.message.chat.id);
    await ensureSchema(); const pool=getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`INSERT INTO app_settings(key,value) VALUES('telegram_admin_chat_id',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,[chatId]);
    const secret=process.env.TELEGRAM_WEBHOOK_SECRET?.trim(); if(!secret)throw new Error('WEBHOOK_SECRET_NOT_CONFIGURED');
    await tg('setWebhook',{url:'https://duisun.ru/api/telegram/webhook',secret_token:secret,drop_pending_updates:'false'});
    await sendTelegramMessage(chatId,'✅ Чат привязан. Уведомления по новым FBS-заказам Wildberries включены.');
    return NextResponse.json({ok:true,bound:true,webhook:true});
  }catch(e:any){return NextResponse.json({ok:false,error:String(e?.message||e)},{status:500});}
}
