import { NextResponse } from 'next/server';
import { isAdminSession, rateLimit } from '../../../../../lib/security';
import { importAvitoFinanceRows, parseDelimited } from '../../../../../lib/avito-finance';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
  if(!isAdminSession(request))return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  const limit=rateLimit(request,'avito-finance-import',20,60*1000);
  if(!limit.ok)return NextResponse.json({error:'Слишком много запросов'},{status:429,headers:{'Retry-After':String(limit.retryAfter)}});
  try{
    const type=request.headers.get('content-type')||'';
    let rows:any[]=[];
    if(type.includes('multipart/form-data')){
      const form=await request.formData();
      const file=form.get('file');
      const text=String(form.get('text')||'');
      if(file instanceof File){
        if(file.size>10*1024*1024)return NextResponse.json({error:'Файл слишком большой'},{status:413});
        const raw=await file.text();
        if(file.name.toLowerCase().endsWith('.json')){
          const parsed=JSON.parse(raw);
          rows=Array.isArray(parsed)?parsed:(Array.isArray(parsed?.rows)?parsed.rows:[]);
        }else rows=parseDelimited(raw);
      }else if(text){
        try{const parsed=JSON.parse(text);rows=Array.isArray(parsed)?parsed:(Array.isArray(parsed?.rows)?parsed.rows:[])}
        catch{rows=parseDelimited(text)}
      }
    }else{
      const body=await request.json();
      if(Array.isArray(body))rows=body;
      else if(Array.isArray(body?.rows))rows=body.rows;
      else if(typeof body?.text==='string'){
        try{const parsed=JSON.parse(body.text);rows=Array.isArray(parsed)?parsed:(Array.isArray(parsed?.rows)?parsed.rows:[])}
        catch{rows=parseDelimited(body.text)}
      }
    }
    if(!rows.length)return NextResponse.json({error:'Не найдены строки для импорта'},{status:400});
    const result=await importAvitoFinanceRows(rows);
    return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch(e:any){
    return NextResponse.json({error:String(e?.message||'Не удалось импортировать данные Avito')},{status:400});
  }
}
