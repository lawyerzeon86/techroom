import { NextResponse } from 'next/server';
import { ensureSchema, getPool, rowToProduct } from '../../../lib/db';
import { isAdminSession } from '../../../lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const url = new URL(request.url);
    const includeInactive = url.searchParams.get('includeInactive') === '1' && isAdminSession(request);
    const result = await getPool().query(includeInactive
      ? "SELECT * FROM products WHERE marketplace_source IN ('wb','ozon') ORDER BY sort_order ASC, id ASC LIMIT 5000"
      : "SELECT * FROM products WHERE is_active = TRUE AND marketplace_source IN ('wb','ozon') ORDER BY sort_order ASC, id ASC LIMIT 5000");
    return NextResponse.json(result.rows.map(rowToProduct), { headers: { 'Cache-Control': includeInactive ? 'no-store' : 'public, max-age=30, stale-while-revalidate=60' } });
  } catch {
    return NextResponse.json({ error: 'Сервис временно недоступен' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function POST() {
  return NextResponse.json(
    { error: 'Ручное создание товаров отключено. Каталог формируется только из реальных карточек Ozon и Wildberries.' },
    { status: 409, headers: { 'Cache-Control': 'no-store' } },
  );
}
