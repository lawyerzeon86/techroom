import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = [
  'WB_API_TOKEN','WB_WAREHOUSE_ID',
  'OZON_CLIENT_ID','OZON_API_KEY','OZON_WAREHOUSE_ID','OZON_DESCRIPTION_ATTRIBUTE_ID',
  'AVITO_CLIENT_ID','AVITO_CLIENT_SECRET','AVITO_USER_ID',
  'YANDEX_MARKET_API_KEY','YANDEX_MARKET_BUSINESS_ID',
  'VK_ACCESS_TOKEN','VK_GROUP_ID',
  'TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET','TELEGRAM_ADMIN_CHAT_ID',
  'MAX_BOT_TOKEN','MAX_WEBHOOK_SECRET','MAX_ADMIN_USER_ID',
  'WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_APP_SECRET','WHATSAPP_VERIFY_TOKEN','WHATSAPP_GRAPH_VERSION',
  'YOOKASSA_SHOP_ID','YOOKASSA_SECRET_KEY',
  'OPENAI_API_KEY','OPENAI_MODEL'
] as const;

function equal(a:string,b:string){
  const ah=createHash('sha256').update(a).digest();
  const bh=createHash('sha256').update(b).digest();
  return timingSafeEqual(ah,bh);
}

export async function GET(request: Request) {
  const configured=process.env.INTEGRATION_MIGRATION_TOKEN?.trim()||'';
  const provided=request.headers.get('x-migration-token')?.trim()||'';
  if(!configured||!provided||!equal(configured,provided)){
    return NextResponse.json({error:'Unauthorized'},{status:401,headers:{'Cache-Control':'no-store'}});
  }
  const values:Record<string,string>={};
  for(const key of ALLOWED){
    const value=process.env[key]?.trim();
    if(value)values[key]=value;
  }
  return NextResponse.json({ok:true,values},{headers:{'Cache-Control':'no-store'}});
}
