import { ensureSchema, getPool } from './db';
import { getWarehouseSettings } from './marketplace-settings';

function positive(...values:any[]){
  for(const value of values){
    const n=Math.round(Number(value));
    if(Number.isFinite(n)&&n>0)return n;
  }
  return 0;
}

function ozonStock(payload:any){
  const rows=payload?.raw?.info?.stocks?.stocks;
  if(!Array.isArray(rows))return null;
  return rows.reduce((sum:number,row:any)=>sum+Math.max(0,Math.round(Number(row?.present||0))-Math.round(Number(row?.reserved||0))),0);
}

function wbBarcodes(payload:any){
  const result:string[]=[];
  for(const size of Array.isArray(payload?.raw?.sizes)?payload.raw.sizes:[]){
    for(const sku of Array.isArray(size?.skus)?size.skus:[]){
      if(sku)result.push(String(sku));
    }
  }
  return [...new Set(result)];
}

async function wbWarehouseIds(){
  const token=process.env.WB_API_TOKEN?.trim();
  if(!token)return [] as string[];
  try{
    const r=await fetch('https://marketplace-api.wildberries.ru/api/v3/warehouses',{headers:{Authorization:token},cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(r.ok){
      const j=await r.json();
      const rows=Array.isArray(j)?j:Array.isArray(j?.warehouses)?j.warehouses:[];
      const ids=rows.map((x:any)=>String(x?.id||x?.warehouseId||'')).filter(Boolean);
      if(ids.length)return [...new Set(ids)];
    }
  }catch{}
  const settings=await getWarehouseSettings().catch(()=>({wbWarehouseId:null as string|null}));
  return settings.wbWarehouseId?[String(settings.wbWarehouseId)]:[];
}

async function wbStocks(products:any[]){
  const token=process.env.WB_API_TOKEN?.trim();
  const warehouses=await wbWarehouseIds();
  const totals=new Map<string,number>();
  if(!token||!warehouses.length)return {totals,warehouses};
  const barcodes=[...new Set(products.flatMap((p:any)=>wbBarcodes(p.marketplace_payload)))];
  for(const warehouseId of warehouses){
    for(let i=0;i<barcodes.length;i+=1000){
      const part=barcodes.slice(i,i+1000);
      if(!part.length)continue;
      try{
        const r=await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(warehouseId)}`,{
          method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({skus:part}),cache:'no-store',signal:AbortSignal.timeout(20000)
        });
        if(!r.ok)continue;
        const j=await r.json();
        for(const row of Array.isArray(j?.stocks)?j.stocks:[]){
          const sku=String(row?.sku||'');
          if(!sku)continue;
          totals.set(sku,(totals.get(sku)||0)+Math.max(0,Math.round(Number(row?.amount||0))));
        }
      }catch{}
    }
  }
  return {totals,warehouses};
}

export async function refreshSiteCatalogFacts(){
  await ensureSchema();
  const pool=getPool();
  const {rows}=await pool.query(`SELECT id,sku,price,stock,marketplace_source,marketplace_payload FROM products WHERE is_active=TRUE AND marketplace_source IN ('wb','ozon') ORDER BY id`);
  const wbRows=rows.filter((p:any)=>p.marketplace_source==='wb');
  const {totals:wbMap,warehouses}=await wbStocks(wbRows);
  let updated=0,prices=0,stocks=0;
  for(const p of rows){
    const payload=p.marketplace_payload||{};
    let stock:number|null=null;
    let price=0;
    if(p.marketplace_source==='ozon'){
      stock=ozonStock(payload);
      price=positive(payload?.price,payload?.raw?.info?.price,payload?.raw?.info?.marketing_price);
    }else if(p.marketplace_source==='wb'){
      const codes=wbBarcodes(payload);
      if(warehouses.length)stock=codes.reduce((sum,sku)=>sum+(wbMap.get(sku)||0),0);
      price=positive(payload?.price);
    }
    const nextPrice=price>0?price:Number(p.price)||0;
    const nextStock=stock===null?Number(p.stock)||0:stock;
    if(nextPrice!==Number(p.price))prices++;
    if(nextStock!==Number(p.stock))stocks++;
    await pool.query(`UPDATE products SET price=$2,stock=$3,rating=0,reviews=0,badge=NULL,emoji=NULL,updated_at=NOW() WHERE id=$1`,[p.id,nextPrice,nextStock]);
    await pool.query(`UPDATE price_sheet SET price=$2,updated_at=NOW() WHERE sku=$1`,[String(p.sku||''),nextPrice]);
    updated++;
  }
  return {updated,priceChanges:prices,stockChanges:stocks,wbWarehouses:warehouses.length};
}
