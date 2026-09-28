import { NextResponse } from 'next/server';
import { ensureSchema, getPool } from '../../../../lib/db';
import { rateLimit } from '../../../../lib/security';
import { getYooKassaPayment, persistPaymentStatus } from '../../../../lib/yookassa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limit = rateLimit(request, 'payment-status', 30, 60_000);
  if (!limit.ok) return NextResponse.json({ error: 'Слишком много запросов' }, { status: 429 });
  const url = new URL(request.url);
  const orderNumber = url.searchParams.get('order')?.trim() || '';
  const token = url.searchParams.get('token')?.trim() || '';
  if (!/^TR-[A-Z0-9-]{6,32}$/.test(orderNumber) || token.length < 32) {
    return NextResponse.json({ error: 'Некорректная ссылка' }, { status: 400 });
  }
  await ensureSchema();
  const result = await getPool().query(
    `SELECT id,order_number,total_amount,status,payment_status,payment_id,payment_url,paid_at
     FROM orders WHERE order_number=$1 AND payment_token=$2 LIMIT 1`,
    [orderNumber, token],
  );
  if (!result.rowCount) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
  let order = result.rows[0];
  if (order.payment_id && !['succeeded', 'canceled'].includes(order.payment_status)) {
    try {
      await persistPaymentStatus(await getYooKassaPayment(order.payment_id));
      const refreshed = await getPool().query(
        `SELECT id,order_number,total_amount,status,payment_status,payment_id,payment_url,paid_at FROM orders WHERE id=$1`,
        [order.id],
      );
      order = refreshed.rows[0];
    } catch {
      // Keep the last verified state; a temporary provider error must not change it.
    }
  }
  return NextResponse.json({
    orderNumber: order.order_number,
    totalAmount: Number(order.total_amount),
    status: order.status,
    paymentStatus: order.payment_status,
    paymentUrl: order.payment_url,
    paidAt: order.paid_at,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
