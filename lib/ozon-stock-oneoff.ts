function headers(){
  const id=process.env.OZON_CLIENT_ID?.trim(),key=process.env.OZON_API_KEY?.trim();
  if(!id||!key)throw new Error('OZON_NOT_CONFIGURED');
  return {'Client-Id':id,'Api-Key':key,'Content-Type':'application/json'};
}
async function ozon(path:string,body:any){
  const r=await fetch('https://api-seller.ozon.ru'+path,{method:'POST',headers:headers(),body:JSON.stringify(body),cache:'no-store'});
  const text=await r.text();let data:any={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!r.ok)throw new Error('OZON_'+r.status+': '+String(data?.message||data?.error||text).slice(0,1200));
  return data;
}
export async function setAudiCoverStock10(){
  const offerId='AUDI-A4B8-XENON-COVER-2PCS';
  const configured=Number(process.env.OZON_WAREHOUSE_ID||0);
  const wh=await ozon('/v2/warehouse/list',{limit:100,cursor:''});
  const warehouses=Array.isArray(wh?.warehouses)?wh.warehouses:(Array.isArray(wh?.result)?wh.result:[]);
  let warehouseId=Number.isSafeInteger(configured)&&configured>0?configured:0;
  let chosenBy=warehouseId?'env':'';

  if(!warehouseId){
    try{
      const s=await ozon('/v2/product/info/stocks-by-warehouse/fbs',{
        limit:100,cursor:'',offer_id:['R8W0821653','DAK8T54A53A','FenderAudiA4B8front','AUDI-ARCH-A4B8-A58T']
      });
      const rows=Array.isArray(s?.products)?s.products:[];
      const counts=new Map<number,number>();
      for(const x of rows){
        const id=Number(x?.warehouse_id||0); if(id>0)counts.set(id,(counts.get(id)||0)+1);
      }
      const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]);
      if(ranked.length){warehouseId=ranked[0][0];chosenBy='existing_stocks'}
    }catch(e:any){console.warn('[ozon-stock-10] stock warehouse probe failed',String(e?.message||e))}
  }

  if(!warehouseId){
    const candidates=warehouses.filter((w:any)=>{
      const st=String(w?.status||'').toLowerCase();
      return Number(w?.warehouse_id)>0 && !w?.is_rfbs && !w?.is_karantin && (!st||/active|created/.test(st));
    });
    if(candidates.length===1){warehouseId=Number(candidates[0].warehouse_id);chosenBy='single_fbs'}
  }
  if(!warehouseId)throw new Error('OZON_WAREHOUSE_NOT_RESOLVED');

  const upd=await ozon('/v2/products/stocks',{stocks:[{offer_id:offerId,stock:10,warehouse_id:warehouseId}]});
  await new Promise(r=>setTimeout(r,1500));
  const verify=await ozon('/v2/product/info/stocks-by-warehouse/fbs',{limit:100,cursor:'',offer_id:[offerId]});
  const rows=Array.isArray(verify?.products)?verify.products:[];
  return {
    offerId,warehouseId,chosenBy,
    warehouseName:String(warehouses.find((w:any)=>Number(w?.warehouse_id)===warehouseId)?.name||''),
    update:upd,
    verify:rows.map((x:any)=>({
      warehouse_id:Number(x?.warehouse_id||0),warehouse_name:String(x?.warehouse_name||''),
      present:Number(x?.present||0),reserved:Number(x?.reserved||0),free_stock:Number(x?.free_stock||0),
      offer_id:String(x?.offer_id||'')
    }))
  };
}
