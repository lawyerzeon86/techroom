import { NextRequest, NextResponse } from 'next/server'
import { publishSiteProductToMarketplaces } from '../../../../lib/site-product-publish'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SYNC_SECRET || ''
  return Boolean(secret) && req.headers.get('x-cron-secret') === secret
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }

  let body: any = {}
  try { body = await req.json() } catch {}

  let skus: string[] = []
  if (typeof body?.sku === 'string' && body.sku.trim()) {
    skus = [body.sku.trim()]
  } else if (Array.isArray(body?.skus)) {
    skus = body.skus.map((v: unknown) => String(v || '').trim()).filter(Boolean)
  } else {
    const origin = new URL(req.url).origin
    const res = await fetch(origin + '/api/products', { cache: 'no-store' })
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: 'PRODUCT_LIST_FAILED', status: res.status }, { status: 502 })
    }
    const payload: any = await res.json()
    const list = Array.isArray(payload) ? payload : (payload?.products || [])
    skus = list
      .filter((p: any) => p && p.isActive !== false && p.is_active !== false && p.sku)
      .map((p: any) => String(p.sku).trim())
      .filter(Boolean)
  }

  skus = [...new Set(skus)].slice(0, 500)
  const results: any[] = []

  for (const sku of skus) {
    try {
      const result = await publishSiteProductToMarketplaces(sku)
      results.push({ sku, ok: true, result })
    } catch (error: any) {
      results.push({ sku, ok: false, error: String(error?.message || error) })
    }
  }

  const failed = results.filter(x => !x.ok)
  return NextResponse.json({
    ok: failed.length === 0,
    processed: results.length,
    failed: failed.length,
    results
  }, { status: failed.length ? 207 : 200 })
}
