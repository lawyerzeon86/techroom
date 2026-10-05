import fs from 'node:fs';
import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const wbToken=process.env.WB_API_TOKEN;
const headers={'Client-Id':process.env.OZON_CLIENT_ID,'Api-Key':process.env.OZON_API_KEY,'Content-Type':'application/json'};
async function api(url,body,headers){
  const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw new Error('SOURCE_HTTP_'+r.status);
  return r.json();
}
try{
  const initialized=await fetch('http://127.0.0.1:3000/api/products');
  if(!initialized.ok)throw new Error('CATALOG_INITIALIZATION_FAILED');
  const rows=(await pool.query("SELECT * FROM products WHERE is_active AND marketplace_source IN ('wb','ozon') ORDER BY id")).rows;
  const wb=new Map();let cursor={limit:100};
  if(wbToken)for(let page=0;page<20;page++){
    const d=await api('https://content-api.wildberries.ru/content/v2/get/cards/list',{settings:{cursor,filter:{withPhoto:-1},sort:{ascending:false}}},{Authorization:wbToken,'Content-Type':'application/json'});
    for(const c of d.cards||[])wb.set(String(c.vendorCode),c);
    if(!d.cursor||Number(d.cursor.total)<100)break;
    cursor={limit:100,updatedAt:d.cursor.updatedAt,nmID:d.cursor.nmID};
  }
  const report=[];
  for(const p of rows){
    let source=null,description=null,name=null,issue=null;
    try{
      const c=wb.get(String(p.sku));
      // Exact seller SKU; prefer this independent source to repair mixed descriptions.
      if(c){source='wb';description=String(c.description||'');name=String(c.title||'');}
      else if(p.marketplace_source==='ozon'){
        const info=await api('https://api-seller.ozon.ru/v3/product/info/list',{offer_id:[String(p.sku)],product_id:[],sku:[]},headers);
        const item=(info.items||info.result?.items||[]).find(x=>String(x.offer_id)===String(p.sku));
        if(!item)throw new Error('SKU_NOT_FOUND');
        const d=await api('https://api-seller.ozon.ru/v1/product/info/description',{product_id:Number(item.id),offer_id:String(p.sku)},headers);
        if(String(d.result?.id)!==String(item.id)||String(d.result?.offer_id)!==String(p.sku))throw new Error('DESCRIPTION_IDENTITY_MISMATCH');
        source='ozon';description=String(d.result.description||'');name=String(d.result.name||item.name||'');
      }else issue='SOURCE_NOT_FOUND';
      if(p.description_override!=null){description=p.description_override;source='editor';name=p.title;}
      if(['dskgothring1','dskgothtoy1'].includes(String(p.sku))&&/белая ваза|высотой около 34/i.test(String(description))){
        description=p.sku==='dskgothring1'?'Готическое кольцо с декоративной чёрной розой. Артикул: dskgothring1.':'Готическая декоративная фигурка-призрак из ASA-пластика. Артикул: dskgothtoy1.';
        await pool.query("UPDATE products SET specs='',specs_override='',description_override=$1 WHERE id=$2",[description,p.id]);
      }
      if(p.sku==='MinecraftSkeletonW'&&/Красный Скелетон/.test(String(description))){
        description=description.replaceAll('Красный Скелетон','Белый Скелетон').replaceAll('красный скелетон','белый скелетон');
      }
      if(description===''){description=String(p.title)+'. Артикул: '+String(p.sku)+'.';}
      if(description!==null){
        await pool.query('UPDATE products SET description=$1,description_override=CASE WHEN description IS DISTINCT FROM $1 THEN $1 ELSE description_override END,updated_at=NOW() WHERE id=$2',[description,p.id]);
        await pool.query('UPDATE marketplace_product_hub SET description=$1,updated_at=NOW() WHERE canonical_sku=$2',[description,p.sku]);
      }
    }catch(e){issue=e.message;}
    const r=await fetch('http://127.0.0.1:3000/product/'+p.id,{signal:AbortSignal.timeout(30000)});
    if(!r.ok)issue='PRODUCT_PAGE_'+r.status;
    if(!p.title||!p.sku||Number(p.price)<=0||(!p.image_url&&!p.image_urls?.length))issue=issue||'INCOMPLETE_CARD';
    const changed=description!==null&&description!==String(p.description||'');
    report.push({id:p.id,sku:p.sku,title:p.title,sourceName:name,source,changed,issue,descriptionPreview:String(description??p.description??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,180)});
  }
  fs.mkdirSync('/root/duisun-audits',{recursive:true,mode:0o700});
  fs.writeFileSync('/root/duisun-audits/catalog.json',JSON.stringify({at:new Date().toISOString(),cards:report},null,2),{mode:0o600});
  console.log('CATALOG_AUDIT',JSON.stringify({total:report.length,changed:report.filter(x=>x.changed).length,issues:report.filter(x=>x.issue)}));
  for(const r of report)console.log('CARD',JSON.stringify(r));
}finally{await pool.end();}
