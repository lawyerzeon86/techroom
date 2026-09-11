import { NextResponse } from 'next/server';
import { isAdminSession } from '../../../../lib/security';

export async function GET(request: Request) {
  return NextResponse.json({ authenticated: isAdminSession(request) }, { headers: { 'Cache-Control': 'no-store' } });
}
