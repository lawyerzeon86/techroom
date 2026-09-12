import { NextResponse } from 'next/server';
import { isAdminSession } from '../../../../../lib/security';
import { contentStatus } from '../../../../../lib/marketplace-content';

export async function GET(request: Request) {
  if (!isAdminSession(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(contentStatus());
}
