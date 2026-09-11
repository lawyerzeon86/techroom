import { NextResponse } from 'next/server';
import { createAdminSessionCookie, rateLimit, readJsonBody, verifyAdminPassword } from '../../../../lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limit = rateLimit(request, 'admin-login', 8, 15 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json({ error: 'Слишком много попыток. Попробуйте позже.' }, {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfter), 'Cache-Control': 'no-store' },
    });
  }
  try {
    const body = await readJsonBody(request, 8 * 1024);
    if (!verifyAdminPassword(typeof body?.password === 'string' ? body.password : '')) {
      return NextResponse.json({ error: 'Неверный пароль' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    response.headers.set('Set-Cookie', createAdminSessionCookie());
    return response;
  } catch (error: any) {
    const status = error?.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    return NextResponse.json({ error: 'Некорректный запрос' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
