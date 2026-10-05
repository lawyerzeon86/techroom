// Private SSH stream consumed by the deployment runner; never print this in logs.
process.stdout.write(JSON.stringify({TELEGRAM_BOT_TOKEN:process.env.TELEGRAM_BOT_TOKEN||'',TELEGRAM_WEBHOOK_SECRET:process.env.TELEGRAM_WEBHOOK_SECRET||''}));
const token=process.env.TELEGRAM_BOT_TOKEN;
console.error('INTEGRATIONS_CONFIGURED',JSON.stringify({
  wb:Boolean(process.env.WB_API_TOKEN),ozon:Boolean(process.env.OZON_CLIENT_ID&&process.env.OZON_API_KEY),
  telegram:Boolean(token),whatsapp:Boolean(process.env.WHATSAPP_ACCESS_TOKEN&&process.env.WHATSAPP_PHONE_NUMBER_ID&&process.env.WHATSAPP_APP_SECRET),
  payments:Boolean(process.env.YOOKASSA_SHOP_ID&&process.env.YOOKASSA_SECRET_KEY),vk:Boolean(process.env.VK_ACCESS_TOKEN&&process.env.VK_GROUP_ID),
  avito:Boolean(process.env.AVITO_CLIENT_ID&&process.env.AVITO_CLIENT_SECRET),yandex:Boolean(process.env.YANDEX_MARKET_API_KEY&&process.env.YANDEX_MARKET_BUSINESS_ID)
}));
