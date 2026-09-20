import { getProducts } from './marketplace-content';
import { ensureProductHubSchema } from './product-hub';
import { getPool } from './db';
import { syncPriceSheetFromWildberries } from './price-sheet';

export async function syncTechRoomPricesFromWildberries(){
  let products:any[]=[];
  let source='wildberries_api';
  try{
    products=await getProducts('wb','',100);
    products=products.filter((p:any)=>Number(p?.price)>0);
  }catch(e:any){
    source='stored_wb_catalog';
    await ensureProductHubSchema();
    const {rows}=await getPool().query(`SELECT canonical_sku,title,source_payload FROM marketplace_product_hub WHERE source_marketplace='wb' ORDER BY updated_at DESC LIMIT 500`);
    products=rows.map((r:any)=>({sku:r.canonical_sku,offerId:r.canonical_sku,title:r.title,price:Number(r.source_payload?.price)||0})).filter((p:any)=>p.price>0);
    console.warn('[wb-price-source] live WB read failed, using stored catalog',String(e?.message||e));
  }
  const result=await syncPriceSheetFromWildberries(products);
  return {...result,source,received:products.length};
}
