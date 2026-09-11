import { NextResponse } from 'next/server';
import { ensureSchema, getPool, rowToProduct } from '../../../../lib/db';
import { isAdminSession, parseProductId, rateLimit, readJsonBody, validateProduct } from '../../../../lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminSession(request)) return NextResponse.json({ error: 'Требуется вход администратора' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const limit = rateLimit(request, 'admin-write', 120, 60 * 1000);
  if (!limit.ok) return NextResponse.json({ error: 'Слишком много запросов' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter), 'Cache-Control': 'no-store' } });
  try {
    await ensureSchema();
    const { id: rawId } = await context.params;
    const id = parseProductId(rawId);
    if (!id) return NextResponse.json({ error: 'Некорректный ID' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    const b = validateProduct(await readJsonBody(request));
    const result = await getPool().query(
      `UPDATE products SET category=$1,title=$2,price=$3,old_price=$4,rating=$5,reviews=$6,badge=$7,emoji=$8,image_url=$9,sku=$10,oem=$11,stock=$12,description=$13,specs=$14,is_active=$15,sort_order=$16,updated_at=NOW()
       WHERE id=$17 RETURNING *`,
      [b.category,b.title,b.price,b.oldPrice,b.rating,b.reviews,b.badge,b.emoji,b.imageUrl,b.sku,b.oem,b.stock,b.description,b.specs,b.isActive,b.sortOrder,id]
    );
    if (!result.rowCount) return NextResponse.json({ error: 'Товар не найден' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json(rowToProduct(result.rows[0]), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    const status = error?.message === 'PAYLOAD_TOO_LARGE' ? 413 : error?.message === 'VALIDATION' || error?.message === 'INVALID_JSON' ? 400 : 500;
    return NextResponse.json({ error: status === 500 ? 'Не удалось сохранить товар' : 'Проверьте введённые данные' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminSession(request)) return NextResponse.json({ error: 'Требуется вход администратора' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const limit = rateLimit(request, 'admin-write', 60, 60 * 1000);
  if (!limit.ok) return NextResponse.json({ error: 'Слишком много запросов' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter), 'Cache-Control': 'no-store' } });
  try {
    await ensureSchema();
    const { id: rawId } = await context.params;
    const id = parseProductId(rawId);
    if (!id) return NextResponse.json({ error: 'Некорректный ID' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    const result = await getPool().query('DELETE FROM products WHERE id=$1', [id]);
    if (!result.rowCount) return NextResponse.json({ error: 'Товар не найден' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Не удалось удалить товар' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
