import { NextResponse } from 'next/server';
import { ensureSchema, getPool } from '../../../../lib/db';
import { importMarketplaceProducts, syncHubCatalogToSite } from '../../../../lib/product-hub';
import { getWarehouseSettings } from '../../../../lib/marketplace-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ozonActualStock(payload: any) {
  const rows = payload?.raw?.info?.stocks?.stocks;
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum: number, row: any) => {
    const present = Number(row?.present || 0);
    const reserved = Number(row?.reserved || 0);
    return sum + Math.max(0, present - reserved);
  }, 0);
}

function wbBarcodes(payload: any) {
  const out: string[] = [];
  for (const size of Array.isArray(payload?.raw?.sizes) ? payload.raw.sizes : []) {
    for (const sku of Array.isArray(size?.skus) ? size.skus : []) if (sku) out.push(String(sku));
  }
  return [...new Set(out)];
}

async function wbStockMap(products: any[]) {
  const token = process.env.WB_API_TOKEN?.trim();
  if (!token) return new Map<string, number>();
  const settings = await getWarehouseSettings().catch(() => ({ wbWarehouseId: null as string | null }));
  if (!settings.wbWarehouseId) return new Map<string, number>();
  const all = [...new Set(products.flatMap((p: any) => wbBarcodes(p.marketplace_payload)))];
  const amounts = new Map<string, number>();
  for (let i = 0; i < all.length; i += 1000) {
    const part = all.slice(i, i + 1000);
    const response = await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(String(settings.wbWarehouseId))}`, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ skus: part }),
      cache: 'no-store',
    });
    if (!response.ok) continue;
    const data = await response.json().catch(() => ({ stocks: [] }));
    for (const row of Array.isArray(data?.stocks) ? data.stocks : []) {
      amounts.set(String(row?.sku || ''), Math.max(0, Number(row?.amount || 0)));
    }
  }
  return amounts;
}

export async function GET() {
  const result: any = { imports: {}, site: null, products: [] };
  try {
    await ensureSchema();
    if (process.env.WB_API_TOKEN?.trim()) {
      try { result.imports.wb = await importMarketplaceProducts('wb', 100); }
      catch (e: any) { result.imports.wb = { error: String(e?.message || e) }; }
    } else result.imports.wb = { skipped: 'not_configured' };

    if (process.env.OZON_CLIENT_ID?.trim() && process.env.OZON_API_KEY?.trim()) {
      try { result.imports.ozon = await importMarketplaceProducts('ozon', 100); }
      catch (e: any) { result.imports.ozon = { error: String(e?.message || e) }; }
    } else result.imports.ozon = { skipped: 'not_configured' };

    try { result.site = await syncHubCatalogToSite(); }
    catch (e: any) { result.site = { error: String(e?.message || e) }; }

    const { rows } = await getPool().query(`
      SELECT id,category,title,price,old_price,rating,reviews,badge,emoji,image_url,image_urls,
             sku,oem,stock,description,specs,is_active,sort_order,marketplace_source,
             marketplace_product_id,marketplace_payload
      FROM products
      WHERE marketplace_source IN ('wb','ozon')
      ORDER BY sort_order ASC,id ASC
      LIMIT 5000
    `);
    const wbMap = await wbStockMap(rows.filter((p: any) => p.marketplace_source === 'wb')).catch(() => new Map<string, number>());
    result.products = rows.map((p: any) => {
      let actualStock = 0;
      if (p.marketplace_source === 'ozon') actualStock = ozonActualStock(p.marketplace_payload);
      if (p.marketplace_source === 'wb') actualStock = wbBarcodes(p.marketplace_payload).reduce((sum, sku) => sum + (wbMap.get(sku) || 0), 0);
      return { ...p, actual_stock: actualStock };
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
