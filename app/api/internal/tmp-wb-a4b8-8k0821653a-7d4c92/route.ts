import { NextResponse } from 'next/server';
import { ensureSchema, getPool } from '../../../../lib/db';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(){
  try{
    const token=process.env.WB_API_TOKEN?.trim();
    const warehouseId=process.env.WB_WAREHOUSE_ID?.trim();
    if(!token) return NextResponse.json({error:'WB_API_TOKEN_NOT_CONFIGURED'},{status:500});
    if(!warehouseId) return NextResponse.json({error:'WB_WAREHOUSE_ID_NOT_CONFIGURED'},{status:500});

    const matches:any[]=[];
    let cursor:any={limit:100};
    for(let page=0;page<20;page++){
      const res=await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list',{
        method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},
        body:JSON.stringify({settings:{cursor,filter:{withPhoto:-1},sort:{ascending:false}}}),cache:'no-store'
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok) return NextResponse.json({error:data?.message||`WB_CARDS_${res.status}`},{status:502});
      const cards=Array.isArray(data?.cards)?data.cards:[];
      for(const card of cards){
        const hay=`${card?.title||''} ${card?.vendorCode||''}`.toLowerCase();
        if(hay.includes('8k0821653a')) matches.push(card);
      }
      if(matches.length||cards.length<100) break;
      const next=data?.cursor;
      if(!next?.updatedAt||!next?.nmID) break;
      cursor={limit:100,updatedAt:next.updatedAt,nmID:next.nmID};
    }
    if(!matches.length) return NextResponse.json({error:'TARGET_NOT_FOUND'},{status:404});

    const stocks:any[]=[];
    for(const card of matches){
      for(const size of Array.isArray(card?.sizes)?card.sizes:[]){
        for(const barcode of Array.isArray(size?.skus)?size.skus:[]){
          stocks.push({sku:String(barcode),amount:10});
        }
      }
    }
    if(!stocks.length) return NextResponse.json({error:'NO_BARCODES',matches:matches.map(c=>({nmID:c.nmID,vendorCode:c.vendorCode,title:c.title}))},{status:409});

    const update=await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(warehouseId)}`,{
      method:'PUT',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({stocks}),cache:'no-store'
    });
    const updateText=await update.text();
    if(!update.ok) return NextResponse.json({error:`WB_STOCK_${update.status}`,detail:updateText.slice(0,1000)},{status:502});

    await ensureSchema();
    const pool=getPool();
    const local=await pool.query(`UPDATE products SET stock=10,updated_at=NOW() WHERE lower(COALESCE(title,'')) LIKE '%8k0821653a%' OR lower(COALESCE(sku,'')) LIKE '%8k0821653a%' RETURNING id,sku,title,stock`);

    return NextResponse.json({ok:true,stock:10,warehouseId,wb:matches.map(c=>({nmID:c.nmID,vendorCode:c.vendorCode,title:c.title})),barcodes:stocks.map(x=>x.sku),local:local.rows});
  }catch(error:any){
    return NextResponse.json({error:String(error?.message||error)},{status:500});
  }
}
