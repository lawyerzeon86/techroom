import { NextResponse } from 'next/server';
import { rateLimit, readJsonBody } from '../../../../lib/security';
import { escapeTelegram, sendTelegramMessage } from '../../../../lib/telegram';
import { ensureSchema, getPool } from '../../../../lib/db';
export const runtime='nodejs'; export const dynamic='force-dynamic';
async function bindAdmin(chatId:string|number){
  await ensureSchema();
  const pool=getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const existing=await pool.query(`SELECT value FROM app_settings WHERE key='telegram_admin_chat_id' LIMIT 1`);
  if(existing.rowCount)return false;
  await pool.query(`INSERT INTO app_settings(key,value) VALUES('telegram_admin_chat_id',$1)`,[String(chatId)]);
  return true;
}
export async function POST(request:Request){
  const secret=process.env.TELEGRAM_WEBHOOK_SECRET; if(!secret||request.headers.get('x-telegram-bot-api-secret-token')!==secret)return NextResponse.json({ok:false},{status:401});
  if(!rateLimit(request,'telegram-webhook',300,60_000).ok)return NextResponse.json({ok:false},{status:429});
  try{
    const u=await readJsonBody(request,256*1024); const message=u?.message; const chatId=message?.chat?.id; const text=String(message?.text||'');
    if(chatId&&text==='/bindadmin'){
      const bound=await bindAdmin(chatId);
      await sendTelegramMessage(chatId,bound?'✅ Этот чат привязан для FBS-уведомлений Wildberries.':'ℹ️ Административный чат уже привязан.');
      return NextResponse.json({ok:true});
    }
    if(chatId&&(text==='/start'||text==='/shop'||text==='Магазин')){
      const url=process.env.TELEGRAM_WEBAPP_URL;
      if(url)await sendTelegramMessage(chatId,`Привет, ${escapeTelegram(message.from?.first_name||'друг')}! Добро пожаловать в Duisun.`,{inline_keyboard:[[{text:'🛍 Открыть магазин',web_app:{url}}],[{text:'📦 Мои заказы',web_app:{url:`${url.replace(/\/$/,'')}/?tab=orders`}}]]});
    }
    return NextResponse.json({ok:true});
  }catch{return NextResponse.json({ok:true})}
}
