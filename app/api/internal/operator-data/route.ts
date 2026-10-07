import { NextResponse } from 'next/server';
import { getPool } from '../../../../lib/db';
import { getWarehouseSettings } from '../../../../lib/marketplace-settings';
import { verifyOperatorGitHubActionsToken } from '../../../../lib/github-oidc';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function clampLimit(value:any, fallback=200, max=1000){
  const n=Math.round(Number(value));
  return Number.isFinite(n)?Math.min(max,Math.max(1,n)):fallback;
}

async function wbFbsCatalog(){
  const token=process.env.WB_API_TOKEN?.trim();
  if(!token)throw new Error('WB_API_TOKEN_NOT_CONFIGURED');
  const settings=await getWarehouseSettings();
  const warehouseId=settings.wbWarehouseId;
  if(!warehouseId)throw new Error('WB_WAREHOUSE_ID_NOT_CONFIGURED');

  const cards:any[]=[];
  let cursor:any={limit:100};
  for(let page=0;page<50;page++){
    const res=await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list',{
      method:'POST',
      headers:{Authorization:token,'Content-Type':'application/json'},
      body:JSON.stringify({settings:{cursor,filter:{withPhoto:-1},sort:{ascending:false}}}),
      cache:'no-store',
      signal:AbortSignal.timeout(20000),
    });
    const data:any=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(String(data?.message||`WB_CARDS_${res.status}`));
    const part=Array.isArray(data?.cards)?data.cards:[];
    cards.push(...part);
    if(part.length<100||!data?.cursor?.updatedAt||!data?.cursor?.nmID)break;
    cursor={limit:100,updatedAt:data.cursor.updatedAt,nmID:data.cursor.nmID};
  }

  const barcodes:string[]=[];
  const byBarcode=new Map<string,{nmID:number|null,vendorCode:string,title:string}>();
  for(const card of cards){
    for(const size of Array.isArray(card?.sizes)?card.sizes:[]){
      for(const raw of Array.isArray(size?.skus)?size.skus:[]){
        const barcode=String(raw||'').trim();
        if(!barcode)continue;
        barcodes.push(barcode);
        byBarcode.set(barcode,{nmID:card?.nmID==null?null:Number(card.nmID),vendorCode:String(card?.vendorCode||''),title:String(card?.title||'')});
      }
    }
  }

  const stockMap=new Map<string,number>();
  for(let i=0;i<barcodes.length;i+=1000){
    const part=barcodes.slice(i,i+1000);
    const res=await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(String(warehouseId))}`,{
      method:'POST',
      headers:{Authorization:token,'Content-Type':'application/json'},
      body:JSON.stringify({skus:part}),
      cache:'no-store',
      signal:AbortSignal.timeout(20000),
    });
    const data:any=await res.json().catch(()=>[]);
    if(!res.ok)throw new Error(String(data?.message||`WB_STOCKS_${res.status}`));
    for(const row of Array.isArray(data)?data:[]){
      const sku=String(row?.sku||'').trim();
      if(sku)stockMap.set(sku,Number(row?.amount)||0);
    }
  }

  const grouped=new Map<string,{nmID:number|null,vendorCode:string,title:string,stock:number,barcodes:string[]}>();
  for(const [barcode,meta] of byBarcode){
    const key=meta.nmID!=null?String(meta.nmID):`${meta.vendorCode}|${meta.title}`;
    const current=grouped.get(key)||{...meta,stock:0,barcodes:[]};
    current.stock+=stockMap.get(barcode)||0;
    current.barcodes.push(barcode);
    grouped.set(key,current);
  }
  return {warehouseId,cards:[...grouped.values()].sort((a,b)=>a.vendorCode.localeCompare(b.vendorCode,'ru'))};
}

export async function POST(request:Request){
  const bearer=request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]||'';
  if(!bearer||!await verifyOperatorGitHubActionsToken(bearer).catch(()=>false)){
    return NextResponse.json({error:'Unauthorized'},{status:401});
  }
  try{
    const body:any=await request.json().catch(()=>({}));
    const action=String(body?.action||'');
    if(action==='db_health'){
      const result=await getPool().query('SELECT NOW() AS server_time, current_database() AS database');
      return NextResponse.json({ok:true,action,row:result.rows[0]},{headers:{'Cache-Control':'no-store'}});
    }
    if(action==='db_catalog'){
      const q=String(body?.q||'').trim();
      const limit=clampLimit(body?.limit,200,1000);
      const result=await getPool().query(
        `SELECT id,sku,title,stock,price,is_active,marketplace_source,updated_at
         FROM products
         WHERE ($1='' OR sku ILIKE '%'||$1||'%' OR title ILIKE '%'||$1||'%')
         ORDER BY title,sku
         LIMIT $2`,[q,limit]
      );
      return NextResponse.json({ok:true,action,count:result.rows.length,rows:result.rows},{headers:{'Cache-Control':'no-store'}});
    }
    if(action==='wb_fbs_catalog'){
      const result=await wbFbsCatalog();
      return NextResponse.json({ok:true,action,...result},{headers:{'Cache-Control':'no-store'}});
    }
    return NextResponse.json({error:'Unsupported action'},{status:400});
  }catch(e:any){
    return NextResponse.json({error:String(e?.message||e)},{status:500,headers:{'Cache-Control':'no-store'}});
  }
}
