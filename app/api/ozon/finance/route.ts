import { NextRequest, NextResponse } from "next/server";
import { getOzonFinanceTransactions, isOzonConfigured } from "../../../../lib/ozon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function operationsOf(payload: any): any[] {
  return payload?.result?.operations ?? payload?.operations ?? [];
}

function pageCountOf(payload: any): number {
  return Number(payload?.result?.page_count ?? payload?.page_count ?? 1) || 1;
}

function summarize(operations: any[]) {
  const byType: Record<string, { count: number; amount: number }> = {};
  let total = 0;
  let services = 0;
  let accruals = 0;

  for (const op of operations) {
    const amount = Number(op?.amount ?? 0) || 0;
    const accrual = Number(op?.accruals_for_sale ?? 0) || 0;
    const serviceTotal = Array.isArray(op?.services)
      ? op.services.reduce((sum: number, s: any) => sum + (Number(s?.price ?? 0) || 0), 0)
      : 0;
    const type = String(op?.operation_type_name ?? op?.operation_type ?? "other");
    total += amount;
    accruals += accrual;
    services += serviceTotal;
    byType[type] ??= { count: 0, amount: 0 };
    byType[type].count += 1;
    byType[type].amount += amount;
  }

  return {
    transactionCount: operations.length,
    netTransactionAmount: Math.round(total * 100) / 100,
    accrualsForSale: Math.round(accruals * 100) / 100,
    services: Math.round(services * 100) / 100,
    byType: Object.entries(byType)
      .map(([type, value]) => ({ type, ...value, amount: Math.round(value.amount * 100) / 100 }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
  };
}

export async function GET(request: NextRequest) {
  if (!isOzonConfigured()) {
    return NextResponse.json({ ok: false, error: "OZON_NOT_CONFIGURED" }, { status: 503 });
  }

  const now = new Date();
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const from = request.nextUrl.searchParams.get("from") ?? defaultFrom;
  const to = request.nextUrl.searchParams.get("to") ?? now.toISOString();

  try {
    const first = await getOzonFinanceTransactions(from, to, 1, 1000);
    const all = [...operationsOf(first)];
    const pageCount = Math.min(pageCountOf(first), 100);
    for (let page = 2; page <= pageCount; page++) {
      const next = await getOzonFinanceTransactions(from, to, page, 1000);
      all.push(...operationsOf(next));
    }
    return NextResponse.json({ ok: true, from, to, summary: summarize(all), data: first });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OZON_REQUEST_FAILED";
    console.error("[ozon-finance]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
