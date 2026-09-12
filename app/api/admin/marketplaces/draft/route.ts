import { NextResponse } from 'next/server';
import { isAdminSession, rateLimit, readJsonBody } from '../../../../../lib/security';
import { generateReviewDraft, type MarketplaceUi } from '../../../../../lib/marketplace-content';

export async function POST(request: Request) {
  if (!isAdminSession(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rl = rateLimit(request, 'marketplace-draft', 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  try {
    const b = await readJsonBody(request, 16 * 1024);
    const marketplace = b.marketplace as MarketplaceUi;
    if (!['wb','ozon'].includes(marketplace)) throw new Error('VALIDATION');
    return NextResponse.json(await generateReviewDraft({
      marketplace,
      rating: Number(b.rating || 0),
      reviewText: String(b.reviewText || '').slice(0, 5000),
      productName: String(b.productName || '').slice(0, 300),
    }));
  } catch (e:any) {
    return NextResponse.json({ error: e.message || 'AI generation error' }, { status: e.status || 502 });
  }
}
