import { NextResponse } from 'next/server';
import { readJsonBody } from '../../../../../lib/security';
import { getYooKassaPayment, persistPaymentStatus } from '../../../../../lib/yookassa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request, 128 * 1024);
    const event = String(body?.event || '');
    const paymentId = String(body?.object?.id || '');
    if (!['payment.succeeded', 'payment.canceled', 'payment.waiting_for_capture'].includes(event)) {
      return NextResponse.json({ ok: true, ignored: true });
    }
    if (!paymentId) return NextResponse.json({ error: 'Invalid notification' }, { status: 400 });

    // Never trust fields from the incoming webhook: load the authoritative object
    // from YooKassa using our secret key, then validate order and amount in the DB update.
    await persistPaymentStatus(await getYooKassaPayment(paymentId));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    const message = String(error?.message || error);
    const status = message === 'PAYLOAD_TOO_LARGE' ? 413 : message === 'INVALID_JSON' ? 400 : 500;
    return NextResponse.json({ error: 'Webhook processing failed' }, { status });
  }
}
