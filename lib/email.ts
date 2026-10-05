import { getPool } from './db';

export function emailConfigured(){
  return Boolean(process.env.SMTP_HOST?.trim()&&process.env.SMTP_USER?.trim()&&(process.env.SMTP_PASSWORD||process.env.SMTP_PASS)?.trim()&&(process.env.EMAIL_FROM||process.env.SMTP_FROM)?.trim());
}

export async function queueOrderEmail(to:string|null,orderNumber:string,total:number){
  if(!to||!emailConfigured())return false;
  await getPool().query('INSERT INTO email_outbox(order_number,payload) VALUES($1,$2::jsonb) ON CONFLICT(order_number) DO NOTHING',[
    orderNumber,JSON.stringify({to,subject:`TechRoom: заказ ${orderNumber} принят`,text:`Заказ ${orderNumber} сохранён.\nСумма: ${total.toLocaleString('ru-RU')} ₽.\nМенеджер уточнит доставку и оплату.\nМагазин: https://duisun.ru`})
  ]);
  return true;
}
