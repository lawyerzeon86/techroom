import { NextResponse } from 'next/server';
import { yooKassaConfigured } from '../../../../lib/yookassa';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { sbpAvailable: yooKassaConfigured() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
