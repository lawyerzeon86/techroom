import { NextResponse } from 'next/server';
import { getPool } from '../../../lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const startedAt = Date.now();
    await getPool().query('SELECT 1');
    return NextResponse.json(
      {
        ok: true,
        service: 'techroom-store',
        database: 'connected',
        latencyMs: Date.now() - startedAt,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, service: 'techroom-store', database: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
