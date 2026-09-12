import { NextResponse } from 'next/server';
import { ensureSchema, getPool } from '../../../lib/db';
import { rateLimit, readJsonBody } from '../../../lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(value: unknown, max: number, required = false) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (required && !v) throw new Error('VALIDATION');
  if (v.length > max) throw new Error('VALIDATION');
  return v || null;
}

function validatePhone(value: unknown) {
  const v = text(value, 32, true)!;
  if (!/^[+()\-\s\d]{7,32}$/.test(v)) throw new Error('VALIDATION');
  return v;
}

function validateEmail(value: unknown) {
  const v = text(value, 200);
  if (!v) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error('VALIDATION');
  return v;
}

function orderNumber() {
  const now = new Date();
  const y = now.getUTCFullYear().toString().slice(-2);
  const m = String(now.getUTCMonth()+1).padStart(2,'0');
  const d = String(now.getUTCDate()).padStart(2,'0');
  const suffix = Math.random().toString(36).slice(2,7).toUpperCase();
  return `TR-${y}${m}${d}-${suffix}`;
}

export async function POST(request: Request) {
  const limit = rateLimit(request, 'checkout', 10, 60 * 1000);
  if (!limit.ok) return NextResponse.json({error:'Слишком много попыток оформления. Попробуйте позже.'},{status:429,headers:{'Retry-After':String(limit.retryAfter)}});

  try {
    await ensureSchema();
    const body = await readJsonBody(request, 64 * 1024);
    const customerName = text(body?.customerName, 120, true)!;
    const phone = validatePhone(body?.phone);
    const email = validateEmail(body?.email);
    const deliveryMethod = body?.deliveryMethod === 'pickup' ? 'pickup' : body?.deliveryMethod === 'courier' ? 'courier' : null;
    const paymentMethod = body?.paymentMethod === 'qr' ? 'qr' : body?.paymentMethod === 'cash' ? 'cash' : null;
    if (!deliveryMethod || !paymentMethod) throw new Error('VALIDATION');
    const address = deliveryMethod === 'courier' ? text(body?.address, 500, true) : text(body?.address, 500);
    const comment = text(body?.comment, 2000);

    const rawItems = Array.isArray(body?.items) ? body.items : [];
    if (!rawItems.length || rawItems.length > 100) throw new Error('VALIDATION');

    const quantities = new Map<number, number>();
    for (const item of rawItems) {
      const productId = Number(item?.productId);
      const quantity = Math.round(Number(item?.quantity));
      if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isFinite(quantity) || quantity < 1 || quantity > 99) throw new Error('VALIDATION');
      quantities.set(productId, Math.min(99, (quantities.get(productId)||0) + quantity));
    }

    const ids = [...quantities.keys()];
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const products = await client.query(
        'SELECT id,title,sku,price,stock,is_active FROM products WHERE id = ANY($1::int[]) FOR UPDATE',
        [ids]
      );
      if (products.rows.length !== ids.length) throw new Error('PRODUCT_NOT_FOUND');

      let total = 0;
      const lines = products.rows.map((p:any)=>{
        const quantity = quantities.get(Number(p.id)) || 0;
        if (!p.is_active || Number(p.stock) < quantity) throw new Error('OUT_OF_STOCK');
        const price = Number(p.price);
        const lineTotal = price * quantity;
        total += lineTotal;
        return {id:Number(p.id),title:p.title,sku:p.sku,price,quantity,lineTotal};
      });
      if (total <= 0 || total > 500_000_000) throw new Error('VALIDATION');

      let number = orderNumber();
      let orderResult;
      for (let attempt=0; attempt<3; attempt++) {
        try {
          orderResult = await client.query(
            `INSERT INTO orders (order_number,customer_name,phone,email,delivery_method,address,payment_method,comment,total_amount,status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'new') RETURNING id,order_number,total_amount,status,created_at`,
            [number,customerName,phone,email,deliveryMethod,address,paymentMethod,comment,total]
          );
          break;
        } catch (err:any) {
          if (err?.code !== '23505' || attempt===2) throw err;
          number = orderNumber();
        }
      }
      const order = orderResult!.rows[0];

      for (const line of lines) {
        await client.query(
          `INSERT INTO order_items (order_id,product_id,title,sku,price,quantity,line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [order.id,line.id,line.title,line.sku,line.price,line.quantity,line.lineTotal]
        );
        await client.query('UPDATE products SET stock=stock-$1,updated_at=NOW() WHERE id=$2',[line.quantity,line.id]);
      }

      await client.query('COMMIT');
      return NextResponse.json({
        ok:true,
        orderNumber:order.order_number,
        totalAmount:Number(order.total_amount),
        status:order.status,
        paymentMethod,
      },{status:201,headers:{'Cache-Control':'no-store'}});
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error:any) {
    const code = error?.message;
    if (code === 'OUT_OF_STOCK') return NextResponse.json({error:'Некоторых товаров уже нет в нужном количестве. Обновите корзину.'},{status:409});
    if (code === 'PRODUCT_NOT_FOUND') return NextResponse.json({error:'Один из товаров больше недоступен.'},{status:409});
    if (code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({error:'Слишком большой запрос.'},{status:413});
    if (code === 'VALIDATION' || code === 'INVALID_JSON') return NextResponse.json({error:'Проверьте данные заказа.'},{status:400});
    return NextResponse.json({error:'Не удалось оформить заказ. Попробуйте ещё раз.'},{status:500});
  }
}
