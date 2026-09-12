import { NextResponse } from 'next/server';
import { isAdminSession } from '../../../../../lib/security';
import { marketplaceConfig } from '../../../../../lib/marketplaces';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request){
  if(!isAdminSession(request)) return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  return NextResponse.json({configured:marketplaceConfig()},{headers:{'Cache-Control':'no-store'}});
}
