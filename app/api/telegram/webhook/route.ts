import { NextResponse } from 'next/server';
import { rateLimit, readJsonBody } from '../../../../lib/security';
import { escapeTelegram, sendTelegramMessage } from '../../../../lib/telegram';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function POST(request:Request){
  const secret=process.env.TELEGRAM_WEBHOOK_SECRET; if(!secret||request.headers.get('x-telegram-bot-api-secret-token')!==secret)return NextResponse.json({ok:false},{status:401});
  if(!rateLimit(request,'telegram-webhook',300,60_000).ok)return NextResponse.json({ok:false},{status:429});
  try{const u=await readJsonBody(request,256*1024);const message=u?.message;const chatId=message?.chat?.id;if(chatId&&(message.text==='/start'||message.text==='/shop'||message.text==='Магазин')){const url=process.env.TELEGRAM_WEBAPP_URL;if(url)await sendTelegramMessage(chatId,`Привет, ${escapeTelegram(message.from?.first_name||'друг')}! Добро пожаловать в TechRoom. Откройте каталог, чтобы выбрать товары и оформить заказ.`,{inline_keyboard:[[{text:'🛍 Открыть магазин',web_app:{url}}],[{text:'📦 Мои заказы',web_app:{url:`${url.replace(/\/$/,'')}/?tab=orders`}}]]});}return NextResponse.json({ok:true})}catch{return NextResponse.json({ok:true})}
}
