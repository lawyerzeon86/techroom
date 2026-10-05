const token=process.env.TELEGRAM_BOT_TOKEN;
if(token){
  const secret=process.env.TELEGRAM_WEBHOOK_SECRET;
  if(!secret)throw new Error('TELEGRAM_WEBHOOK_SECRET_MISSING');
  async function call(method,body){
    const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const data=await r.json();
    if(!r.ok||!data.ok)throw new Error('TELEGRAM_CONFIGURATION_'+(data.error_code||r.status));
    return data.result;
  }
  await call('setWebhook',{url:'https://duisun.ru/api/telegram/webhook',secret_token:secret,allowed_updates:['message'],drop_pending_updates:false});
  await call('setChatMenuButton',{menu_button:{type:'web_app',text:'Duisun',web_app:{url:'https://duisun.ru/telegram'}}});
  const info=await call('getWebhookInfo',{});
  if(info.url!=='https://duisun.ru/api/telegram/webhook')throw new Error('TELEGRAM_WEBHOOK_VERIFICATION_FAILED');
  console.log('TELEGRAM_WEBHOOK',JSON.stringify({url:info.url,pending:info.pending_update_count}));
}else console.log('TELEGRAM_NOT_CONFIGURED');
console.log('INTEGRATIONS_CONFIGURED',JSON.stringify({
  wb:Boolean(process.env.WB_API_TOKEN),ozon:Boolean(process.env.OZON_CLIENT_ID&&process.env.OZON_API_KEY),
  telegram:Boolean(token),whatsapp:Boolean(process.env.WHATSAPP_ACCESS_TOKEN&&process.env.WHATSAPP_PHONE_NUMBER_ID&&process.env.WHATSAPP_APP_SECRET),
  payments:Boolean(process.env.YOOKASSA_SHOP_ID&&process.env.YOOKASSA_SECRET_KEY),vk:Boolean(process.env.VK_ACCESS_TOKEN&&process.env.VK_GROUP_ID),
  avito:Boolean(process.env.AVITO_CLIENT_ID&&process.env.AVITO_CLIENT_SECRET),yandex:Boolean(process.env.YANDEX_MARKET_API_KEY&&process.env.YANDEX_MARKET_BUSINESS_ID)
}));
