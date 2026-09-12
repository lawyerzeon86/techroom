import { NextResponse } from 'next/server';
import { isAdminSession, rateLimit } from '../../../../../lib/security';
import { getProducts, type MarketplaceUi } from '../../../../../lib/marketplace-content';

export async function GET(request: Request) {
  if (!isAdminSession(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rl = rateLimit(request, 'marketplace-products', 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  const u = new URL(request.url);
  const marketplace = u.searchParams.get('marketplace') as MarketplaceUi;
  if (!['wb','ozon'].includes(marketplace)) return NextResponse.json({ error: 'Invalid marketplace' }, { status: 400 });
  try {
    return NextResponse.json(await getProducts(marketplace, u.searchParams.get('q') || '', Number(u.searchParams.get('limit') || 50)));
  } catch (e:any) {
    return NextResponse.json({ error: e.message || 'Marketplace API error' }, { status: e.status || 502 });
  }
}
