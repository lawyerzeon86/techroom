import { NextRequest, NextResponse } from "next/server";
import { getOzonFinanceTransactions, isOzonConfigured } from "@/lib/ozon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isOzonConfigured()) {
    return NextResponse.json({ ok: false, error: "OZON_NOT_CONFIGURED" }, { status: 503 });
  }

  const now = new Date();
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const from = request.nextUrl.searchParams.get("from") ?? defaultFrom;
  const to = request.nextUrl.searchParams.get("to") ?? now.toISOString();

  try {
    const data = await getOzonFinanceTransactions(from, to);
    return NextResponse.json({ ok: true, from, to, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OZON_REQUEST_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
