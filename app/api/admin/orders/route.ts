import { NextResponse } from 'next/server';
import { ensureSchema, getPool } from '../../../../lib/db';
import { isAdminSession } from '../../../../lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isAdminSession(request)) {
    return NextResponse.json({ error: 'Требуется вход администратора' }, { status: 401 });
  }

  await ensureSchema();
  const pool = getPool();
  const site = await pool.query(`
    SELECT o.*, COALESCE(
      json_agg(json_build_object(
        'title', oi.title,
        'sku', oi.sku,
        'price', oi.price,
        'quantity', oi.quantity,
        'lineTotal', oi.line_total
      ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL),
      '[]'::json
    ) AS items
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT 1000
  `);

  const market = await pool.query(`
    SELECT * FROM marketplace_orders
    ORDER BY COALESCE(external_created_at, synced_at) DESC
    LIMIT 1000
  `);

  const orders = [
    ...site.rows.map((o: any) => ({
      id: String(o.id),
      source: 'site',
      orderNumber: o.order_number,
      status: o.status,
      totalAmount: Number(o.total_amount),
      customerName: o.customer_name,
      phone: o.phone,
      email: o.email,
      deliveryMethod: o.delivery_method,
      address: o.address,
      paymentMethod: o.payment_method,
      comment: o.comment,
      items: o.items || [],
      createdAt: o.created_at,
      updatedAt: o.updated_at
    })),
    ...market.rows.map((o: any) => ({
      id: String(o.id),
      source: o.source,
      externalId: o.external_id,
      orderNumber: o.order_number || o.external_id,
      status: o.status,
      totalAmount: Number(o.total_amount),
      customerName: o.customer_name,
      phone: o.phone,
      items: o.items || [],
      createdAt: o.external_created_at || o.synced_at,
      syncedAt: o.synced_at,
      updatedAt: o.updated_at
    }))
  ].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({ orders }, { headers: { 'Cache-Control': 'no-store' } });
}
