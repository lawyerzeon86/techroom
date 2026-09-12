import { NextResponse } from 'next/server';
import { isAdminSession, readJsonBody } from '../../../../../lib/security';
import { syncMarketplace } from '../../../../../lib/marketplaces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isAdminSession(request)) {
    return NextResponse.json({ error: 'Требуется вход администратора' }, { status: 401 });
  }
  try {
    const body = await readJsonBody(request);
    const marketplace = String(body?.marketplace || '');
    if (marketplace !== 'wildberries' && marketplace !== 'ozon') {
      return NextResponse.json({ error: 'Неизвестный маркетплейс' }, { status: 400 });
    }
    const result = await syncMarketplace(marketplace);
    return NextResponse.json({ ok: true, synced: result.synced });
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message || 'Ошибка синхронизации') }, { status: 502 });
  }
}
