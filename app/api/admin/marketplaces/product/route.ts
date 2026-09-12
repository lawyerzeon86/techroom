import { NextResponse } from 'next/server';
import { isAdminSession, rateLimit, readJsonBody } from '../../../../../lib/security';
import { updateProductText, type MarketplaceUi } from '../../../../../lib/marketplace-content';

export async function PATCH(request: Request) {
  if (!isAdminSession(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rl = rateLimit(request, 'marketplace-product-update', 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  try {
    const b = await readJsonBody(request, 32 * 1024);
    const marketplace = b.marketplace as MarketplaceUi;
    if (!['wb','ozon'].includes(marketplace)) throw new Error('VALIDATION');
    const result = await updateProductText(marketplace, {
      id: b.id ? String(b.id) : undefined,
      offerId: b.offerId ? String(b.offerId) : undefined,
      title: b.title,
      description: b.description,
      ozonDescriptionAttributeId: b.ozonDescriptionAttributeId ? Number(b.ozonDescriptionAttributeId) : undefined,
    });
    return NextResponse.json({ ok: true, result });
  } catch (e:any) {
    const known:any = {
      VALIDATION: [400, 'Проверьте поля'],
      WB_CARD_NOT_FOUND: [404, 'Карточка WB не найдена'],
      OZON_TITLE_UPDATE_REQUIRES_FULL_IMPORT: [400, 'Название Ozon этим безопасным методом не меняется. Здесь доступно изменение описания.'],
      OZON_DESCRIPTION_ATTRIBUTE_ID_NOT_CONFIGURED: [400, 'Не задан OZON_DESCRIPTION_ATTRIBUTE_ID'],
    };
    const k = known[e.message];
    return NextResponse.json({ error: k?.[1] || e.message || 'Marketplace API error' }, { status: e.status || k?.[0] || 502 });
  }
}
