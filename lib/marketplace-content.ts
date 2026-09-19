export type MarketplaceUi='wb'|'ozon';

function env(name:string){return process.env[name]?.trim()||null}
function timeoutMs(){return Number(process.env.MARKETPLACE_API_TIMEOUT_MS||15000)}
async function fetchJson(url:string,init:RequestInit={}){
  const c=new AbortController();
  const t=setTimeout(()=>c.abort(),timeoutMs());
  try{
    const r=await fetch(url,{...init,signal:c.signal,cache:'no-store'});
    const text=await r.text();let data:any={};
    try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
    if(!r.ok){const e:any=new Error(String(data?.message||data?.errorText||data?.error||data?.errors?.[0]?.message||`HTTP_${r.status}`));e.status=r.status;throw e}
    return data;
  }finally{clearTimeout(t)}
}
function wbHeaders(){const token=env('WB_API_TOKEN');if(!token)throw new Error('WB_API_TOKEN_NOT_CONFIGURED');return{Authorization:token,'Content-Type':'application/json'}}
function ozonHeaders(){const id=env('OZON_CLIENT_ID'),key=env('OZON_API_KEY');if(!id||!key)throw new Error('OZON_NOT_CONFIGURED');return{'Client-Id':id,'Api-Key':key,'Content-Type':'application/json'}}
export function contentStatus(){return{wb:{configured:Boolean(env('WB_API_TOKEN'))},ozon:{configured:Boolean(env('OZON_CLIENT_ID')&&env('OZON_API_KEY'))},ai:{configured:Boolean(env('OPENAI_API_KEY')),model:env('OPENAI_MODEL')||'gpt-5.6-luna'}}}

function imageList(value:any){
  if(!Array.isArray(value))return [];
  return value.map((x:any)=>typeof x==='string'?x:(x?.big||x?.url||x?.file_name||x?.original||x?.c516x688||x?.c246x328||'')).filter((x:any)=>typeof x==='string'&&/^https?:\/\//i.test(x));
}
function firstPositiveNumber(...values:any[]){
  for(const value of values){const n=Number(value);if(Number.isFinite(n)&&n>0)return n}
  return 0;
}
function ozonSitePrice(info:any){return firstPositiveNumber(info?.min_price,info?.price,info?.marketing_price,info?.min_ozon_price)}
function attrObject(value:any){
  if(!Array.isArray(value))return {};
  const out:any={};
  for(const a of value){
    const key=String(a?.name||a?.id||a?.attribute_id||'').trim();
    if(!key)continue;
    let v=a?.value??a?.values??a?.value_id??null;
    if(Array.isArray(v))v=v.map((z:any)=>z?.value??z?.dictionary_value??z?.value_id??z).filter((z:any)=>z!==undefined&&z!==null);
    out[key]=v;
  }
  return out;
}
function wbGoodPrice(g:any){
  const sizes=Array.isArray(g?.sizes)?g.sizes:[];
  const prices=sizes.map((s:any)=>Number(s?.discountedPrice??s?.price??0)).filter((n:number)=>Number.isFinite(n)&&n>0);
  if(prices.length)return Math.min(...prices);
  const direct=Number(g?.discountedPrice??g?.price??0);
  return Number.isFinite(direct)&&direct>0?direct:0;
}
async function wbPriceMap(nmIds:(string|number)[]){
  const wanted=new Set(nmIds.map(Number).filter(n=>Number.isFinite(n)&&n>0).map(String));
  const out=new Map<string,number>();
  if(!wanted.size)return out;
  try{
    const limit=1000;
    for(let page=0;page<20&&out.size<wanted.size;page++){
      const qs=new URLSearchParams({limit:String(limit),offset:String(page*limit)});
      const d=await fetchJson(`https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?${qs}`,{headers:wbHeaders()});
      const goods=d?.data?.listGoods||d?.listGoods||[];
      for(const g of goods){const id=String(g?.nmID||'');if(wanted.has(id))out.set(id,wbGoodPrice(g))}
      if(!Array.isArray(goods)||goods.length<limit)break;
      await new Promise(resolve=>setTimeout(resolve,650));
    }
  }catch{}
  return out;
}
function normalizeWbCardBase(c:any){
  const d=c?.dimensions||{};
  return {marketplace:'wb',id:String(c.nmID),offerId:c.vendorCode||null,title:c.title||'',description:c.description||'',sku:c.vendorCode||null,images:imageList(c.photos||c.mediaFiles||c.images),attributes:attrObject(c.characteristics),brand:c.brand||null,category:String(c.subjectName||c.subjectID||''),dimensions:{length:Number(d.length)||0,width:Number(d.width)||0,height:Number(d.height)||0,weight:Number(d.weightBrutto)||0,dimensionUnit:'cm',weightUnit:'kg',valid:d.isValid!==false},raw:c};
}

async function ozonAttributeItems(productIds:(string|number)[]){
  if(!productIds.length)return [];
  const ids=productIds.map(Number).filter(Number.isFinite);
  const d=await fetchJson('https://api-seller.ozon.ru/v4/product/info/attributes',{method:'POST',headers:ozonHeaders(),body:JSON.stringify({filter:{product_id:ids},limit:Math.min(1000,Math.max(1,ids.length))})});
  return d?.result?.items||d?.items||[];
}
async function ozonInfo(offerId:string){
  try{
    const d=await fetchJson('https://api-seller.ozon.ru/v3/product/info/list',{method:'POST',headers:ozonHeaders(),body:JSON.stringify({offer_id:[offerId],product_id:[],sku:[]})});
    return (d?.items||d?.result?.items||[])[0]||{};
  }catch{return {}}
}

export async function getProducts(mp:MarketplaceUi,q='',limit=50){
  limit=Math.max(1,Math.min(100,limit));
  if(mp==='wb'){
    const body:any={settings:{cursor:{limit},filter:{withPhoto:-1},sort:{ascending:false}}};
    if(q.trim())body.settings.filter.textSearch=q.trim();
    const d=await fetchJson('https://content-api.wildberries.ru/content/v2/get/cards/list',{method:'POST',headers:wbHeaders(),body:JSON.stringify(body)});
    const cards=d?.cards||[];
    const prices=await wbPriceMap(cards.map((c:any)=>c.nmID));
    return cards.map((c:any)=>{const p:any=normalizeWbCardBase(c);p.price=prices.get(String(c.nmID))||0;return p});
  }
  const list=await fetchJson('https://api-seller.ozon.ru/v3/product/list',{method:'POST',headers:ozonHeaders(),body:JSON.stringify({filter:{visibility:'ALL'},last_id:'',limit})});
  let items=list?.result?.items||list?.items||[];
  if(q.trim()){const s=q.trim().toLowerCase();items=items.filter((p:any)=>String(p.offer_id||'').toLowerCase().includes(s)||String(p.product_id||'').includes(s))}
  const attrs=await ozonAttributeItems(items.slice(0,limit).map((p:any)=>p.product_id));
  const attrById=new Map(attrs.map((x:any)=>[String(x.id),x]));
  const out:any[]=[];
  for(const p of items.slice(0,limit)){
    let description='';
    try{const d=await fetchJson('https://api-seller.ozon.ru/v1/product/info/description',{method:'POST',headers:ozonHeaders(),body:JSON.stringify({offer_id:String(p.offer_id||'')})});description=d?.result?.description||d?.description||''}catch{}
    const a:any=attrById.get(String(p.product_id))||{};
    const pi:any=await ozonInfo(String(p.offer_id||a.offer_id||''));
    const images=[...imageList(a.images),...imageList(pi.images),...imageList(a.primary_image?[a.primary_image]:[])].filter((x,i,arr)=>arr.indexOf(x)===i);
    const price=ozonSitePrice(pi);
    out.push({marketplace:'ozon',id:String(p.product_id||p.offer_id),offerId:String(p.offer_id||a.offer_id||''),title:String(a.name||pi.name||p.offer_id||p.product_id||'Товар'),description,sku:String(p.offer_id||a.offer_id||p.product_id||''),images,attributes:attrObject(a.attributes),brand:pi.brand||null,category:String(a.description_category_id||a.type_id||''),price,dimensions:{length:Number(a.depth)||0,width:Number(a.width)||0,height:Number(a.height)||0,weight:Number(a.weight)||0,dimensionUnit:String(a.dimension_unit||'mm'),weightUnit:String(a.weight_unit||'g'),valid:true},raw:{list:p,attributes:a,info:pi}})
  }
  return out;
}

function wbPayload(card:any,patch:{title?:string;description?:string;dimensions?:any}){
  const keys=['nmID','vendorCode','brand','title','description','dimensions','characteristics','sizes','kizMarked','wholesale'];
  const x:any={};for(const k of keys)if(card?.[k]!==undefined)x[k]=card[k];
  if(patch.title!==undefined)x.title=patch.title;
  if(patch.description!==undefined)x.description=patch.description;
  if(patch.dimensions!==undefined)x.dimensions=patch.dimensions;
  return x;
}
function positive(v:any,name:string){const n=Number(v);if(!Number.isFinite(n)||n<=0)throw new Error(`INVALID_${name}`);return n}
async function updateWb(p:any){
  if(!p.id)throw new Error('VALIDATION');
  const body={settings:{cursor:{limit:100},filter:{textSearch:String(p.id),withPhoto:-1}}};
  const d=await fetchJson('https://content-api.wildberries.ru/content/v2/get/cards/list',{method:'POST',headers:wbHeaders(),body:JSON.stringify(body)});
  const card=(d?.cards||[]).find((c:any)=>String(c.nmID)===String(p.id));
  if(!card)throw new Error('WB_CARD_NOT_FOUND');
  const patch:any={};
  if(p.title!==undefined)patch.title=String(p.title).trim();
  if(p.description!==undefined)patch.description=String(p.description).trim();
  if(p.dimensions){patch.dimensions={length:positive(p.dimensions.length,'LENGTH'),width:positive(p.dimensions.width,'WIDTH'),height:positive(p.dimensions.height,'HEIGHT'),weightBrutto:positive(p.dimensions.weight,'WEIGHT')}}
  return fetchJson('https://content-api.wildberries.ru/content/v2/cards/update',{method:'POST',headers:wbHeaders(),body:JSON.stringify([wbPayload(card,patch)])});
}
async function updateOzonDimensions(p:any){
  if(!p.offerId||!p.id)throw new Error('VALIDATION');
  const attrs=await ozonAttributeItems([p.id]);
  const a=attrs.find((x:any)=>String(x.id)===String(p.id));
  if(!a)throw new Error('OZON_CARD_NOT_FOUND');
  const info=await fetchJson('https://api-seller.ozon.ru/v3/product/info/list',{method:'POST',headers:ozonHeaders(),body:JSON.stringify({offer_id:[String(p.offerId)],product_id:[],sku:[]})});
  const pi=(info?.items||info?.result?.items||[])[0]||{};
  const dim=p.dimensions||{};
  const item:any={attributes:Array.isArray(a.attributes)?a.attributes:[],barcode:String(a.barcode||pi.barcode||''),description_category_id:Number(a.description_category_id||pi.description_category_id||0),type_id:Number(a.type_id||pi.type_id||0),color_image:String(a.color_image||''),complex_attributes:Array.isArray(a.complex_attributes)?a.complex_attributes:[],currency_code:String(pi.currency_code||'RUB'),depth:Math.round(positive(dim.length,'LENGTH')),dimension_unit:String(dim.dimensionUnit||a.dimension_unit||'mm'),height:Math.round(positive(dim.height,'HEIGHT')),images:imageList(a.images),name:String(a.name||pi.name||p.title||p.offerId),offer_id:String(p.offerId),old_price:String(pi.old_price||'0'),price:String(pi.price||pi.marketing_price||pi.min_ozon_price||'0'),primary_image:String(a.primary_image||''),vat:String(pi.vat||'0'),weight:Math.round(positive(dim.weight,'WEIGHT')),weight_unit:String(dim.weightUnit||a.weight_unit||'g'),width:Math.round(positive(dim.width,'WIDTH'))};
  if(!item.description_category_id||!item.type_id||!Number(item.price))throw new Error('OZON_FULL_CARD_DATA_INCOMPLETE');
  return fetchJson('https://api-seller.ozon.ru/v3/product/import',{method:'POST',headers:ozonHeaders(),body:JSON.stringify({items:[item]})});
}
export async function updateProductText(mp:MarketplaceUi,p:{id?:string;offerId?:string;title?:string;description?:string;ozonDescriptionAttributeId?:number;dimensions?:any}){
  const title=p.title?.trim(),description=p.description?.trim();const hasDimensions=Boolean(p.dimensions);
  if(!title&&!description&&!hasDimensions)throw new Error('VALIDATION');
  if((title?.length||0)>200||(description?.length||0)>10000)throw new Error('VALIDATION');
  if(mp==='wb')return updateWb(p);
  if(hasDimensions)return updateOzonDimensions(p);
  if(!p.offerId)throw new Error('VALIDATION');if(title)throw new Error('OZON_TITLE_UPDATE_REQUIRES_FULL_IMPORT');
  const attr=p.ozonDescriptionAttributeId||Number(process.env.OZON_DESCRIPTION_ATTRIBUTE_ID||0);if(!attr)throw new Error('OZON_DESCRIPTION_ATTRIBUTE_ID_NOT_CONFIGURED');
  return fetchJson('https://api-seller.ozon.ru/v1/product/attributes/update',{method:'POST',headers:ozonHeaders(),body:JSON.stringify({items:[{offer_id:p.offerId,attributes:[{id:attr,complex_id:0,values:[{value:description||''}]}]}]})});
}

function fallback(r:number,text:string){if(r>=5)return text.trim()?'Спасибо за ваш отзыв! Очень рады, что товар вам понравился. Будем рады видеть вас снова!':'Спасибо за высокую оценку! Будем рады видеть вас снова.';if(r===4)return'Спасибо за отзыв и высокую оценку! Учтём ваши замечания и постараемся стать ещё лучше.';if(r<=2)return'Спасибо, что сообщили о проблеме. Нам важно разобраться в ситуации. Пожалуйста, напишите продавцу через официальный канал площадки и укажите детали заказа — постараемся помочь.';return'Спасибо за обратную связь. Мы учтём ваши замечания и постараемся улучшить товар и качество обслуживания.'}
export async function generateReviewDraft(input:{marketplace:MarketplaceUi;rating:number;reviewText:string;productName?:string}){const key=env('OPENAI_API_KEY');if(!key)return{text:fallback(input.rating,input.reviewText),provider:'template'};const model=env('OPENAI_MODEL')||'gpt-5.6-luna';const d=await fetchJson('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,instructions:'Ты менеджер магазина TechRoom. Напиши короткий естественный ответ продавца на отзыв на русском языке. Не выдумывай факты, гарантии, компенсации или контакты. Не спорь. Для негатива прояви эмпатию и предложи официальный канал площадки. 2-4 предложения.',input:`Маркетплейс: ${input.marketplace}. Товар: ${input.productName||'не указан'}. Оценка: ${input.rating}/5. Отзыв: ${input.reviewText||'(без текста)'}`,max_output_tokens:220})});const text=d?.output_text||d?.output?.flatMap((o:any)=>o?.content||[]).map((c:any)=>c?.text||'').join('').trim();return{text:text||fallback(input.rating,input.reviewText),provider:text?'openai':'template'}}