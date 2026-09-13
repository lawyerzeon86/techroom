import { NextResponse } from 'next/server';
import { ensureSchema, getPool, rowToProduct } from '../../../../lib/db';
import { rateLimit } from '../../../../lib/security';
import { telegramUserFromRequest } from '../../../../lib/telegram';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!telegramUserFromRequest(request)) return NextResponse.json({ error: 'Откройте магазин из Telegram-бота.' }, { status: 401 });
  const limit = rateLimit(request, 'telegram-products', 120, 60_000);
  if (!limit.ok) return NextResponse.json({ error: 'Слишком много запросов.' }, { status: 429 });
  try {
    await ensureSchema();
    const result = await getPool().query('SELECT * FROM products WHERE is_active=TRUE ORDER BY sort_order,id LIMIT 5000');
    return NextResponse.json(result.rows.map(rowToProduct), { headers: { 'Cache-Control': 'private, max-age=15' } });
  } catch { return NextResponse.json({ error: 'Каталог временно недоступен.' }, { status: 503 }); }
}
