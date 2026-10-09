import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isAdminCookieHeader } from '../../../lib/security';

export default async function FinanceProtectedLayout({children}:{children:ReactNode}){
  const store=await cookies();
  const header=store.getAll().map(c=>c.name+'='+c.value).join('; ');
  if(!isAdminCookieHeader(header)) redirect('/admin?next=/admin/finance');
  return children;
}
