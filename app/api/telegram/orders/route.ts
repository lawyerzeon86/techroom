import { NextResponse } from 'next/server';
import { ensureSchema, getPool } from '../../../../lib/db';
import { rateLimit, readJsonBody } from '../../../../lib/security';
import { escapeTelegram, sendTelegramMessage, telegramUserFromRequest } from '../../../../lib/telegram';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
const clean=(v:unknown,max:number,required=false)=>{const s=typeof v==='string'?v.trim():'';if((required&&!s)||s.length>max)throw new Error('VALIDATION');return s||null};
const orderNumber=()=>`TR-TG-${new Date().toISOString().slice(2,10).replaceAll('-','')}-${crypto.randomUUID().slice(0,5).toUpperCase()}`;

export async function GET(request: Request) {
  const user=telegramUserFromRequest(request); if(!user)return NextResponse.json({error:'Недействительная сессия Telegram.'},{status:401});
  const limit=rateLimit(request,`tg-orders-${user.id}`,60,60_000);if(!limit.ok)return NextResponse.json({error:'Слишком много запросов.'},{status:429});
  try { await ensureSchema(); const r=await getPool().query(`SELECT order_number,total_amount,status,delivery_method,payment_method,created_at FROM orders WHERE telegram_user_id=$1 ORDER BY created_at DESC LIMIT 30`,[user.id]); return NextResponse.json(r.rows.map(x=>({...x,total_amount:Number(x.total_amount)})),{headers:{'Cache-Control':'no-store'}}); }
  catch{return NextResponse.json({error:'Не удалось получить заказы.'},{status:503})}
}

export async function POST(request: Request) {
  const user=telegramUserFromRequest(request); if(!user)return NextResponse.json({error:'Недействительная сессия Telegram.'},{status:401});
  const limit=rateLimit(request,`tg-checkout-${user.id}`,8,60_000);if(!limit.ok)return NextResponse.json({error:'Слишком много попыток. Попробуйте позже.'},{status:429});
  try {
    await ensureSchema(); const b=await readJsonBody(request); const customerName=clean(b.customerName,120,true)!; const phone=clean(b.phone,32,true)!;
    if(!/^[+()\-\s\d]{7,32}$/.test(phone))throw new Error('VALIDATION');
    const deliveryMethod=b.deliveryMethod==='pickup'?'pickup':b.deliveryMethod==='courier'?'courier':null;
    const paymentMethod=b.paymentMethod==='qr'?'qr':b.paymentMethod==='cash'?'cash':null;
    if(!deliveryMethod||!paymentMethod)throw new Error('VALIDATION');
    const address=deliveryMethod==='courier'?clean(b.address,500,true):clean(b.address,500); const comment=clean(b.comment,2000);
    if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)throw new Error('VALIDATION');
    const quantities=new Map<number,number>(); for(const item of b.items){const id=Number(item?.productId),q=Number(item?.quantity);if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(q)||q<1||q>99)throw new Error('VALIDATION');quantities.set(id,(quantities.get(id)||0)+q)}
    const client=await getPool().connect(); let response:any;
    try { await client.query('BEGIN'); const ids=[...quantities.keys()]; const p=await client.query('SELECT id,title,sku,price,stock,is_active FROM products WHERE id=ANY($1::int[]) FOR UPDATE',[ids]); if(p.rows.length!==ids.length)throw new Error('PRODUCT_NOT_FOUND');
      let total=0; const lines=p.rows.map(x=>{const quantity=quantities.get(Number(x.id))!;if(!x.is_active||Number(x.stock)<quantity)throw new Error('OUT_OF_STOCK');const price=Number(x.price);total+=price*quantity;return{...x,quantity,price,lineTotal:price*quantity}}); if(total<=0||total>500_000_000)throw new Error('VALIDATION');
      const number=orderNumber(); const o=await client.query(`INSERT INTO orders(order_number,customer_name,phone,delivery_method,address,payment_method,comment,total_amount,status,telegram_user_id,telegram_username) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'new',$9,$10) RETURNING id,order_number,total_amount,status`,[number,customerName,phone,deliveryMethod,address,paymentMethod,comment,total,user.id,user.username||null]);
      for(const x of lines){await client.query(`INSERT INTO order_items(order_id,product_id,title,sku,price,quantity,line_total) VALUES($1,$2,$3,$4,$5,$6,$7)`,[o.rows[0].id,x.id,x.title,x.sku,x.price,x.quantity,x.lineTotal]);await client.query('UPDATE products SET stock=stock-$1,updated_at=NOW() WHERE id=$2',[x.quantity,x.id])}
      await client.query('COMMIT'); response={ok:true,orderNumber:number,totalAmount:total,status:'new',paymentMethod};
    } catch(e){await client.query('ROLLBACK');throw e} finally{client.release()}
    const admin=process.env.TELEGRAM_ADMIN_CHAT_ID; if(admin)void sendTelegramMessage(admin,`🛒 <b>Новый заказ ${escapeTelegram(response.orderNumber)}</b>\nКлиент: ${escapeTelegram(customerName)}\nТелефон: ${escapeTelegram(phone)}\nСумма: ${response.totalAmount.toLocaleString('ru-RU')} ₽\nTelegram: ${user.username?'@'+escapeTelegram(user.username):user.id}`).catch(()=>{});
    return NextResponse.json(response,{status:201,headers:{'Cache-Control':'no-store'}});
  } catch(e:any){const c=e?.message;if(c==='OUT_OF_STOCK'||c==='PRODUCT_NOT_FOUND')return NextResponse.json({error:'Товар закончился или недоступен. Обновите корзину.'},{status:409});if(['VALIDATION','INVALID_JSON','PAYLOAD_TOO_LARGE'].includes(c))return NextResponse.json({error:'Проверьте данные заказа.'},{status:400});return NextResponse.json({error:'Не удалось оформить заказ.'},{status:500})}
}
