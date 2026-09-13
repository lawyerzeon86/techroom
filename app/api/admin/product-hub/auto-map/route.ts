import { NextResponse } from 'next/server';
import { isAdminSession } from '../../../../../lib/security';
import { ensureProductHubSchema } from '../../../../../lib/product-hub';
import { getPool } from '../../../../../lib/db';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function words(v:string){return String(v||'').toLowerCase().replace(/[^a-zа-я0-9]+/gi,' ').split(/\s+/).filter(x=>x.length>2)}
function score(q:string,name:string,parent=''){
  const a=new Set(words(q)),b=words(`${name} ${parent}`);if(!a.size||!b.length)return 0;
  let hit=0;for(const t of b)if(a.has(t)||[...a].some(x=>x.includes(t)||t.includes(x)))hit++;
  return Math.min(1,hit/Math.max(2,Math.min(a.size,b.length)));
}
async function readJson(url:string,init:RequestInit){
  const r=await fetch(url,{...init,cache:'no-store'});const text=await r.text();let j:any={};try{j=text?JSON.parse(text):{}}catch{j={}}
  if(!r.ok)throw new Error(String(j?.message||j?.errorText||j?.error||`HTTP_${r.status}`));return j;
}
async function wbSuggest(query:string){
  const token=process.env.WB_API_TOKEN?.trim();if(!token)throw new Error('WB_API_TOKEN_NOT_CONFIGURED');
  const h={Authorization:token,'Content-Type':'application/json'};
  const d=await readJson('https://content-api.wildberries.ru/content/v2/object/all?limit=1000&offset=0',{method:'GET',headers:h});
  const list=Array.isArray(d?.data)?d.data:[];
  const best=list.map((x:any)=>({...x,s:score(query,String(x.subjectName||''),String(x.parentName||''))})).sort((a:any,b:any)=>b.s-a.s)[0];
  if(!best||best.s<0.45)return null;
  const c=await readJson(`https://content-api.wildberries.ru/content/v2/object/charcs/${best.subjectID}`,{method:'GET',headers:h});
  const chars=Array.isArray(c?.data)?c.data:[];
  return {subjectId:Number(best.subjectID),name:String(best.subjectName||''),parentName:String(best.parentName||''),confidence:Number(best.s),required:chars.filter((x:any)=>x?.required===true).map((x:any)=>({id:Number(x.charcID||x.id||0),name:String(x.name||''),hasFilter:Boolean(x.hasFilter)}))};
}
function flattenOzon(n:any,parent=''):any[]{
  const out:any[]=[];const title=String(n?.category_name||n?.name||'');const types=Array.isArray(n?.type)?n.type:Array.isArray(n?.types)?n.types:[];
  for(const t of types)out.push({categoryId:Number(n?.description_category_id||n?.category_id||0),typeId:Number(t?.type_id||t?.id||0),name:String(t?.type_name||t?.name||title),parentName:title||parent});
  for(const c of Array.isArray(n?.children)?n.children:[])out.push(...flattenOzon(c,title||parent));return out;
}
async function ozonSuggest(query:string){
  const id=process.env.OZON_CLIENT_ID?.trim(),key=process.env.OZON_API_KEY?.trim();if(!id||!key)throw new Error('OZON_NOT_CONFIGURED');
  const h={'Client-Id':id,'Api-Key':key,'Content-Type':'application/json'};
  const d=await readJson('https://api-seller.ozon.ru/v1/description-category/tree',{method:'POST',headers:h,body:JSON.stringify({language:'DEFAULT'})});
  const roots=Array.isArray(d?.result)?d.result:Array.isArray(d?.result?.items)?d.result.items:Array.isArray(d?.items)?d.items:[];
  const best=roots.flatMap((x:any)=>flattenOzon(x)).map((x:any)=>({...x,s:score(query,x.name,x.parentName)})).filter((x:any)=>x.categoryId&&x.typeId).sort((a:any,b:any)=>b.s-a.s)[0];
  if(!best||best.s<0.45)return null;
  const a=await readJson('https://api-seller.ozon.ru/v1/description-category/attribute',{method:'POST',headers:h,body:JSON.stringify({description_category_id:best.categoryId,type_id:best.typeId,language:'DEFAULT'})});
  const attrs=Array.isArray(a?.result)?a.result:Array.isArray(a?.result?.items)?a.result.items:Array.isArray(a?.items)?a.items:[];
  return {categoryId:best.categoryId,typeId:best.typeId,name:best.name,parentName:best.parentName,confidence:Number(best.s),required:attrs.filter((x:any)=>x?.is_required===true||x?.required===true).map((x:any)=>({id:Number(x.id||x.attribute_id||0),name:String(x.name||'')}))};
}

export async function POST(request:Request){
  if(!isAdminSession(request))return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  try{
    await ensureProductHubSchema();const pool=getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_product_mappings (id BIGSERIAL PRIMARY KEY,hub_id BIGINT NOT NULL REFERENCES marketplace_product_hub(id) ON DELETE CASCADE,target_marketplace TEXT NOT NULL,normalized_category TEXT,mapped_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,confidence NUMERIC(5,4) NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'pending',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(hub_id,target_marketplace))`);
    const {rows}=await pool.query(`SELECT DISTINCT ON (j.hub_id,j.target_marketplace) j.hub_id,j.target_marketplace,h.title,h.description,h.dimensions,h.attributes FROM marketplace_product_jobs j JOIN marketplace_product_hub h ON h.id=j.hub_id WHERE j.status IN ('needs_mapping','manual_review') ORDER BY j.hub_id,j.target_marketplace,j.id DESC LIMIT 100`);
    let autoMapped=0,manualReview=0;
    for(const r of rows){
      const query=`${r.title||''} ${r.description||''}`.slice(0,1500);let m:any=null;
      try{m=r.target_marketplace==='wb'?await wbSuggest(query):await ozonSuggest(query)}catch(e:any){m={error:String(e?.message||e),confidence:0}}
      const confidence=Number(m?.confidence||0);const status=m&&!m.error&&confidence>=0.62?'auto_mapped':'manual_review';
      const mapped={...m,sourceAttributes:r.attributes||{},dimensions:r.dimensions||{}};
      await pool.query(`INSERT INTO marketplace_product_mappings(hub_id,target_marketplace,normalized_category,mapped_attributes,confidence,status,updated_at) VALUES($1,$2,$3,$4::jsonb,$5,$6,NOW()) ON CONFLICT(hub_id,target_marketplace) DO UPDATE SET normalized_category=EXCLUDED.normalized_category,mapped_attributes=EXCLUDED.mapped_attributes,confidence=EXCLUDED.confidence,status=EXCLUDED.status,updated_at=NOW()`,[r.hub_id,r.target_marketplace,String(m?.name||''),JSON.stringify(mapped),confidence,status]);
      await pool.query(`UPDATE marketplace_product_links SET last_status=$3,last_error=$4 WHERE hub_id=$1 AND marketplace=$2`,[r.hub_id,r.target_marketplace,status,m?.error||null]);
      await pool.query(`UPDATE marketplace_product_jobs SET status=$3,message=$4,updated_at=NOW() WHERE hub_id=$1 AND target_marketplace=$2 AND status IN ('needs_mapping','manual_review')`,[r.hub_id,r.target_marketplace,status,m?.error||`${m?.parentName||''} / ${m?.name||''}; confidence ${confidence.toFixed(2)}; required ${m?.required?.length||0}`]);
      if(status==='auto_mapped')autoMapped++;else manualReview++;
    }
    return NextResponse.json({ok:true,processed:rows.length,autoMapped,manualReview});
  }catch(e:any){return NextResponse.json({error:String(e?.message||'Ошибка автосопоставления')},{status:502})}
}
