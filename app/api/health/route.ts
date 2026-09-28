import { NextResponse } from 'next/server';
import { getPool } from '../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();
  try {
    await getPool().query('SELECT 1');
    return NextResponse.json(
      { ok: true, database: 'up', responseMs: Date.now() - started },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, database: 'down', responseMs: Date.now() - started },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
