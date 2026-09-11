import { NextResponse } from 'next/server';
import { clearAdminSessionCookie } from '../../../../lib/security';

export async function POST() {
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.headers.set('Set-Cookie', clearAdminSessionCookie());
  return response;
}
