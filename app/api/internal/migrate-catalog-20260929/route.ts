import { NextResponse } from 'next/server';
import { ensureSchema, getPool } from '../../../../lib/db';
import { importMarketplaceProducts, syncHubCatalogToSite } from '../../../../lib/product-hub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    result.products = rows;
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
