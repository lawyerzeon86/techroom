import { NextRequest, NextResponse } from 'next/server';

const CANONICAL_HOST='duisun.ru';
const ALIAS_HOSTS=new Set([
  'www.duisun.ru',
  'xn--d1akmpic8d.xn--p1ai',
  'www.xn--d1akmpic8d.xn--p1ai',
]);

export function proxy(request:NextRequest){
  if(process.env.RENDER_DISABLED==='1'){
    return NextResponse.json({error:'Service migrated to Selectel'},{status:410});
  }
  const host=(request.headers.get('host')||'').split(':')[0].toLowerCase();
  if(ALIAS_HOSTS.has(host)){
    const url=request.nextUrl.clone();
    url.protocol='https:';
    url.host=CANONICAL_HOST;
    return NextResponse.redirect(url,308);
  }
  return NextResponse.next();
}

export const config={
  matcher:['/((?!_next/static|_next/image|favicon.ico).*)'],
};
