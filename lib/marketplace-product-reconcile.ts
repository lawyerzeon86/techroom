import { ensureSchema, getPool } from './db';
import { getWarehouseSettings } from './marketplace-settings';
import { pushStockForSku } from './auto-sync';
import { publishSiteProductToMarketplaces } from './site-product-publish';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

type Mode='all'|'product'|'stocks'|'prices'|'images'|'check';

function wbHeaders(){
  const token=process.env.WB_API_TOKEN?.trim();
  if(!token) throw new Error('WB_API_TOKEN_NOT_CONFIGURED');
  return {Authorization:token,'Content-Type':'application/json'};
}
function ozonHeaders(){
  const clientId=process.env.OZON_CLIENT_ID?.trim(),apiKey=process.env.OZON_API_KEY?.trim();
  if(!clientId||!apiKey) throw new Error('OZON_NOT_CONFIGURED');
  return {'Client-Id':clientId,'Api-Key':apiKey,'Content-Type':'application/json'};
}
async function read(res:Response){
  const text=await res.text(); let data:any={};
  try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!res.ok)throw new Error(String(data?.message||data?.errorText||data?.error||`HTTP_${res.status}: ${text.slice(0,800)}`));
  return data;
}
function canonicalImage(url:string|null){
  if(!url)return null;
  try{
    const u=new URL(url);
    if(/(?:^|\.)onrender\.com$/i.test(u.hostname)||/techroom-main\.onrender\.com/i.test(u.hostname)){
      return 'https://duisun.ru'+u.pathname;
    }
    return url;
  }catch{
    return 'https://duisun.ru'+(url.startsWith('/')?'':'/')+url;
  }
}
async function product(sku:string){
  await ensureSchema();
  const pool=getPool();
  const r=await pool.query(`SELECT id,sku,title,price,stock,image_url,image_urls,is_active FROM products WHERE sku=$1 LIMIT 1`,[sku]);
  if(!r.rows[0])throw new Error('SITE_PRODUCT_NOT_FOUND');
  const p=r.rows[0];
  const image=canonicalImage(p.image_url);
  const images=(Array.isArray(p.image_urls)?p.image_urls:[]).map((x:any)=>canonicalImage(String(x))).filter(Boolean);
  if(image!==p.image_url||JSON.stringify(images)!==JSON.stringify(p.image_urls||[])){
    await pool.query(`UPDATE products SET image_url=$2,image_urls=$3::jsonb,updated_at=NOW() WHERE sku=$1`,[sku,image,JSON.stringify(images.length?images:(image?[image]:[]))]);
    p.image_url=image;p.image_urls=images.length?images:(image?[image]:[]);
  }
  if(p.image_url&&!/\/uploads\/marketplace\//.test(String(p.image_url))){
    try{
      const u=new URL(String(p.image_url));
      if(u.hostname==='duisun.ru'&&u.pathname.startsWith('/products/')){
        const src=path.join(process.cwd(),'public',u.pathname.replace(/^\//,''));
        const dir=path.join(process.cwd(),'public','uploads','marketplace');
        fs.mkdirSync(dir,{recursive:true});
        const dest=path.join(dir,sku+'-main.jpg');
        execFileSync('convert',[src,'-auto-orient','-strip','-colorspace','sRGB','-resize','900x1125^','-gravity','center','-extent','900x1125','-quality','90',dest],{stdio:'ignore'});
        const normalized='https://duisun.ru/uploads/marketplace/'+encodeURIComponent(sku)+'-main.jpg';
        await pool.query(`UPDATE products SET image_url=$2,image_urls=$3::jsonb,updated_at=NOW() WHERE sku=$1`,[sku,normalized,JSON.stringify([normalized])]);
        p.image_url=normalized;p.image_urls=[normalized];
      }
    }catch{}
  }
  return p;
}
async function wbCard(sku:string){
  const d=await read(await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list',{
    method:'POST',headers:wbHeaders(),cache:'no-store',
    body:JSON.stringify({settings:{cursor:{limit:100},filter:{textSearch:sku,withPhoto:-1},sort:{ascending:false}}})
  }));
  return (Array.isArray(d?.cards)?d.cards:[]).find((x:any)=>String(x?.vendorCode||'')===sku)||null;
}
async function ozonItem(sku:string){
  const d=await read(await fetch('https://api-seller.ozon.ru/v3/product/info/list',{
    method:'POST',headers:ozonHeaders(),cache:'no-store',
    body:JSON.stringify({offer_id:[sku],product_id:[],sku:[]})
  }));
  return (Array.isArray(d?.items)?d.items:(Array.isArray(d?.result?.items)?d.result.items:[]))[0]||null;
}
function imageUrlsFromOzon(item:any){
  const raw=Array.isArray(item?.images)?item.images:[];
  return raw.map((x:any)=>typeof x==='string'?x:(x?.file_name||x?.url||x?.original||x?.big||''))
    .filter((x:any)=>typeof x==='string'&&/^https?:\/\//i.test(x));
}
async function syncImages(sku:string,image:string|null){
  const out:any={wb:{status:'skipped'},ozon:{status:'skipped'}};
  if(image&&process.env.WB_API_TOKEN?.trim()){
    try{
      const card=await wbCard(sku);
      if(!card?.nmID)throw new Error('WB_CARD_NOT_FOUND');
      const candidates=[image];
      try{
        const u=new URL(image);
        if(u.hostname==='duisun.ru'&&u.pathname.startsWith('/products/')){
          candidates.push('https://raw.githubusercontent.com/lawyerzeon86/techroom/main/public'+u.pathname);
        }
      }catch{}
      // If the site file is corrupt or has an invalid MIME type, reuse Ozon's already
      // accepted marketplace image as a valid fallback source for Wildberries.
      try{
        const oz=await ozonItem(sku);
        for(const candidate of imageUrlsFromOzon(oz))candidates.push(candidate);
      }catch{}
      let lastError:any=null,used:string|null=null;
      for(const candidate of [...new Set(candidates)]){
        try{
          await read(await fetch('https://content-api.wildberries.ru/content/v3/media/save',{
            method:'POST',headers:wbHeaders(),cache:'no-store',
            body:JSON.stringify({nmId:Number(card.nmID),data:[candidate]})
          }));
          used=candidate;lastError=null;break;
        }catch(e:any){lastError=e}
      }
      if(lastError&&/неподдерживаемый тип файла|unsupported file type/i.test(String(lastError?.message||lastError))){
        try{
          const u=new URL(image);
          if(u.hostname==='duisun.ru'&&u.pathname.startsWith('/products/')){
            const src=path.join(process.cwd(),'public',u.pathname.replace(/^\//,''));
            const dir=path.join(process.cwd(),'public','uploads','marketplace');
            fs.mkdirSync(dir,{recursive:true});
            const dest=path.join(dir,sku+'-wb.jpg');
            execFileSync('convert',[src,'-auto-orient','-strip','-colorspace','sRGB','-resize','700x933^','-gravity','center','-extent','700x933','-quality','90',dest],{stdio:'ignore'});
            const regenerated='https://duisun.ru/uploads/marketplace/'+encodeURIComponent(sku)+'-wb.jpg';
            await read(await fetch('https://content-api.wildberries.ru/content/v3/media/save',{
              method:'POST',headers:wbHeaders(),cache:'no-store',
              body:JSON.stringify({nmId:Number(card.nmID),data:[regenerated]})
            }));
            used=regenerated;lastError=null;
          }
        }catch(e:any){lastError=e}
      }
      if(lastError)throw lastError;
      if(used&&used!==image){
        try{
          await getPool().query(
            `UPDATE products SET image_url=$2,image_urls=$3::jsonb,updated_at=NOW() WHERE sku=$1`,
            [sku,used,JSON.stringify([used])]
          );
        }catch{}
      }
      out.wb={status:'updated',nmID:Number(card.nmID),image:used};
    }catch(e:any){out.wb={status:'error',error:String(e?.message||e)}}
  }
  if(image&&process.env.OZON_CLIENT_ID?.trim()&&process.env.OZON_API_KEY?.trim()){
    try{
      const item=await ozonItem(sku);
      const count=Array.isArray(item?.images)?item.images.length:0;
      out.ozon={status:count>0?'already_present':'needs_reimport',productId:item?.id||item?.product_id||null,images:count};
      if(count===0){
        const publish=await publishSiteProductToMarketplaces(sku);
        out.ozon={...out.ozon,publish:publish.ozon};
      }
    }catch(e:any){out.ozon={status:'error',error:String(e?.message||e)}}
  }
  return out;
}
async function syncPrices(sku:string,price:number){
  const out:any={wb:{status:'skipped'},ozon:{status:'skipped'}};
  if(process.env.WB_API_TOKEN?.trim()){
    try{
      const card=await wbCard(sku);
      if(!card?.nmID)throw new Error('WB_CARD_NOT_FOUND');
      const data=await read(await fetch('https://discounts-prices-api.wildberries.ru/api/v2/upload/task',{
        method:'POST',headers:wbHeaders(),cache:'no-store',
        body:JSON.stringify({data:[{nmID:Number(card.nmID),price:Math.max(1,Math.round(price))}]})
      }));
      out.wb={status:'submitted',nmID:Number(card.nmID),price:Math.max(1,Math.round(price)),result:data};
    }catch(e:any){
      const msg=String(e?.message||e);
      out.wb=/already set/i.test(msg)?{status:'unchanged',price:Math.max(1,Math.round(price))}:{status:'error',error:msg};
    }
  }
  if(process.env.OZON_CLIENT_ID?.trim()&&process.env.OZON_API_KEY?.trim()){
    try{
      const data=await read(await fetch('https://api-seller.ozon.ru/v1/product/import/prices',{
        method:'POST',headers:ozonHeaders(),cache:'no-store',
        body:JSON.stringify({prices:[{offer_id:sku,price:String(Math.max(1,Math.round(price))),old_price:'0',premium_price:'0',auto_action_enabled:'DISABLED'}]})
      }));
      const errors=(Array.isArray(data?.result)?data.result:[]).flatMap((x:any)=>Array.isArray(x?.errors)?x.errors:[]);
      if(errors.length)throw new Error(JSON.stringify(errors).slice(0,1500));
      out.ozon={status:'submitted',price:Math.max(1,Math.round(price))};
    }catch(e:any){out.ozon={status:'error',error:String(e?.message||e)}}
  }
  return out;
}
async function verify(sku:string,p:any,warehouses:any){
  const out:any={site:{price:Number(p.price),stock:Number(p.stock),image:p.image_url,active:Boolean(p.is_active)},wb:null,ozon:null,errors:[]};
  if(process.env.WB_API_TOKEN?.trim()){
    try{
      const card=await wbCard(sku);
      const barcodes:string[]=[];
      for(const s of Array.isArray(card?.sizes)?card.sizes:[])for(const b of Array.isArray(s?.skus)?s.skus:[])if(b)barcodes.push(String(b));
      let stock:any=null;
      if(warehouses?.wbWarehouseId&&barcodes.length){
        try{
          const sr=await read(await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(String(warehouses.wbWarehouseId))}`,{
            method:'POST',headers:wbHeaders(),cache:'no-store',body:JSON.stringify({skus:barcodes})
          }));
          stock=sr;
        }catch(e:any){stock={error:String(e?.message||e)}}
      }
      let price:any=null;
      if(card?.nmID){
        try{
          price=await read(await fetch(`https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=10&filterNmID=${encodeURIComponent(String(card.nmID))}`,{headers:wbHeaders(),cache:'no-store'}));
        }catch(e:any){price={error:String(e?.message||e)}}
      }
      out.wb={exists:Boolean(card),nmID:card?.nmID||null,title:card?.title||null,mediaFiles:Array.isArray(card?.mediaFiles)?card.mediaFiles.length:null,photos:Array.isArray(card?.photos)?card.photos.length:null,barcodes,stock,price};
      if(!card)out.errors.push('WB_CARD_NOT_FOUND');
    }catch(e:any){out.wb={error:String(e?.message||e)};out.errors.push('WB_CHECK_FAILED')}
  }
  if(process.env.OZON_CLIENT_ID?.trim()&&process.env.OZON_API_KEY?.trim()){
    try{
      const item=await ozonItem(sku);
      out.ozon={exists:Boolean(item),id:item?.id||item?.product_id||null,offerId:item?.offer_id||null,name:item?.name||null,price:item?.price||null,images:Array.isArray(item?.images)?item.images.length:0,stocks:item?.stocks||null,visible:item?.visible??null,status:item?.status||null,statuses:item?.statuses||null,isArchived:item?.is_archived??item?.isArchived??null,hasFbsStocks:item?.has_fbs_stocks??null,hasFboStocks:item?.has_fbo_stocks??null,errors:item?.errors||null};
      if(!item)out.errors.push('OZON_CARD_NOT_FOUND');
      if(item&&Number(item?.price||0)!==Number(p.price))out.errors.push('OZON_PRICE_MISMATCH');
      if(item&&Array.isArray(item?.images)&&item.images.length===0)out.errors.push('OZON_IMAGE_MISSING');
      if(item?.stocks?.has_stock===false)out.errors.push('OZON_STOCK_MISSING');
    }catch(e:any){out.ozon={error:String(e?.message||e)};out.errors.push('OZON_CHECK_FAILED')}
  }
  return out;
}
export async function reconcileMarketplaceProduct(sku:string,mode:Mode='all'){
  const p=await product(sku);
  const warehouses=await getWarehouseSettings();
  const result:any={sku,mode,warehouses:{wb:Boolean(warehouses.wbWarehouseId),ozon:Boolean(warehouses.ozonWarehouseId)},steps:{}};
  if(mode==='all'||mode==='product'){
    result.steps.publish=await publishSiteProductToMarketplaces(sku);
  }
  if(mode==='all'||mode==='images'||mode==='product'){
    result.steps.images=await syncImages(sku,p.image_url);
  }
  if(mode==='all'||mode==='prices'||mode==='product'){
    result.steps.prices=await syncPrices(sku,Number(p.price)||0);
  }
  if(mode==='all'||mode==='stocks'||mode==='product'){
    result.steps.stocks=await pushStockForSku(sku,Number(p.stock)||0,{wbWarehouseId:warehouses.wbWarehouseId,ozonWarehouseId:warehouses.ozonWarehouseId});
  }
  if(mode!=='check')await new Promise(resolve=>setTimeout(resolve,5000));
  result.verify=await verify(sku,p,warehouses);
  result.ok=!result.verify.errors.length&&
    !Object.values(result.steps).some((x:any)=>JSON.stringify(x).includes('"status":"error"'));
  return result;
}
