import { NextResponse } from 'next/server';
import { ensureSchema, getPool, rowToProduct } from '../../../lib/db';
import { isAdminSession, rateLimit, readJsonBody, validateProduct } from '../../../lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const url = new URL(request.url);
    const includeInactive = url.searchParams.get('includeInactive') === '1' && isAdminSession(request);
    const result = await getPool().query(includeInactive
      ? 'SELECT * FROM products ORDER BY sort_order ASC, id ASC LIMIT 5000'
      : 'SELECT * FROM products WHERE is_active = TRUE ORDER BY sort_order ASC, id ASC LIMIT 5000');
    return NextResponse.json(result.rows.map(rowToProduct), { headers: { 'Cache-Control': includeInactive ? 'no-store' : 'public, max-age=30, stale-while-revalidate=60' } });
  } catch {
    return NextResponse.json({ error: 'Сервис временно недоступен' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function POST(request: Request) {
  if (!isAdminSession(request)) return NextResponse.json({ error: 'Требуется вход администратора' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const limit = rateLimit(request, 'admin-write', 120, 60 * 1000);
  if (!limit.ok) return NextResponse.json({ error: 'Слишком много запросов' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter), 'Cache-Control': 'no-store' } });
  try {
    await ensureSchema();
    const b = validateProduct(await readJsonBody(request));
    const result = await getPool().query(
      `INSERT INTO products (category,title,price,old_price,rating,reviews,badge,emoji,image_url,sku,oem,stock,description,specs,is_active,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [b.category,b.title,b.price,b.oldPrice,b.rating,b.reviews,b.badge,b.emoji,b.imageUrl,b.sku,b.oem,b.stock,b.description,b.specs,b.isActive,b.sortOrder]
    );
    return NextResponse.json(rowToProduct(result.rows[0]), { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    const status = error?.message === 'PAYLOAD_TOO_LARGE' ? 413 : error?.message === 'VALIDATION' || error?.message === 'INVALID_JSON' ? 400 : 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось сохранить товар' : 'Проверьте введённые данные' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
