import { createHash } from 'node:crypto';

const API_URL = 'https://api.yookassa.ru/v3';

export type YooKassaPayment = {
  id: string;
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';
  paid?: boolean;
  amount?: { value?: string; currency?: string };
  confirmation?: { type?: string; confirmation_url?: string };
  metadata?: Record<string, unknown>;
  cancellation_details?: { party?: string; reason?: string };
};

function credentials() {
  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();
  if (!shopId || !secretKey) throw new Error('YOOKASSA_NOT_CONFIGURED');
  return { shopId, secretKey };
}

export function yooKassaConfigured() {
  return Boolean(process.env.YOOKASSA_SHOP_ID?.trim() && process.env.YOOKASSA_SECRET_KEY?.trim());
}

async function requestYooKassa<T>(path: string, init: RequestInit = {}) {
  const { shopId, secretKey } = credentials();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = String(data?.description || data?.code || `HTTP_${response.status}`).slice(0, 500);
    throw new Error(`YOOKASSA_${response.status}:${detail}`);
  }
  return data as T;
}

export async function createSbpPayment(input: {
  orderId: string | number;
  orderNumber: string;
  totalAmount: number;
  returnUrl: string;
}) {
  const idempotenceKey = createHash('sha256')
    .update(`techroom:sbp:${input.orderId}:${input.orderNumber}`)
    .digest('hex');
  return requestYooKassa<YooKassaPayment>('/payments', {
    method: 'POST',
    headers: { 'Idempotence-Key': idempotenceKey },
    body: JSON.stringify({
      amount: { value: input.totalAmount.toFixed(2), currency: 'RUB' },
      capture: true,
      payment_method_data: { type: 'sbp' },
      confirmation: { type: 'redirect', return_url: input.returnUrl },
      description: `Оплата заказа ${input.orderNumber}`.slice(0, 128),
      metadata: {
        order_id: String(input.orderId),
        order_number: input.orderNumber,
      },
    }),
  });
}

export function getYooKassaPayment(paymentId: string) {
  if (!/^[\w-]{8,128}$/.test(paymentId)) throw new Error('INVALID_PAYMENT_ID');
  return requestYooKassa<YooKassaPayment>(`/payments/${encodeURIComponent(paymentId)}`);
}

export function paymentOrderStatus(payment: YooKassaPayment) {
  if (payment.status === 'succeeded' && payment.paid) return 'paid';
  if (payment.status === 'canceled') return 'payment_canceled';
  return 'awaiting_payment';
}

export async function persistPaymentStatus(payment: YooKassaPayment) {
  const { ensureSchema, getPool } = await import('./db');
  await ensureSchema();
  const orderId = String(payment.metadata?.order_id || '');
  if (!/^\d+$/.test(orderId)) throw new Error('PAYMENT_ORDER_MISSING');
  const amount = Number(payment.amount?.value);
  const currency = payment.amount?.currency;
  if (!Number.isFinite(amount) || currency !== 'RUB') throw new Error('PAYMENT_AMOUNT_INVALID');

  const result = await getPool().query(
    `UPDATE orders SET
       payment_id=COALESCE(payment_id,$1), payment_status=$2,
       status=$3, paid_at=CASE WHEN $3='paid' THEN COALESCE(paid_at,NOW()) ELSE paid_at END,
       payment_error=CASE WHEN $2='canceled' THEN $4 ELSE NULL END,
       payment_updated_at=NOW(), updated_at=NOW()
     WHERE id=$5 AND payment_provider='yookassa' AND total_amount=$6
       AND (payment_id IS NULL OR payment_id=$1)
     RETURNING id,order_number,total_amount,status,payment_status,payment_token`,
    [
      payment.id,
      payment.status,
      paymentOrderStatus(payment),
      payment.cancellation_details ? JSON.stringify(payment.cancellation_details) : null,
      orderId,
      Math.round(amount),
    ],
  );
  if (!result.rowCount) throw new Error('PAYMENT_ORDER_MISMATCH');
  return result.rows[0];
}
