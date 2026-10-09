import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const execFileAsync=promisify(execFile);
const EXPECTED='4919f87c3b257bfa8c7d12b0acabaa34bd935b24cf4be1b362f116955a53de6d';

export async function GET(request:Request){
  const token=new URL(request.url).searchParams.get('token')||'';
  const actual=createHash('sha256').update(token).digest('hex');
  if(actual!==EXPECTED)return NextResponse.json({error:'not found'},{status:404});
  try{
    const {stdout}=await execFileAsync(process.execPath,['scripts/finance-2026-summary.mjs'],{
      cwd:process.cwd(),
      env:process.env,
      timeout:30000,
      maxBuffer:1024*1024
    });
    const data=JSON.parse(stdout.trim());
    return NextResponse.json(data,{headers:{'Cache-Control':'no-store, private','Pragma':'no-cache'}});
  }catch(e:any){
    console.error('FINANCE_SUMMARY_ONCE_FAILED',String(e?.message||e));
    return NextResponse.json({error:'summary failed'},{status:500});
  }
}
