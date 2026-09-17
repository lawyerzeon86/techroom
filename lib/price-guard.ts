export type PriceGuardRule={sku:string;minPrice:number};

const RULES:PriceGuardRule[]=[
  {sku:'R8W0821653',minPrice:2000},
  {sku:'DAK8T54A53A',minPrice:2000},
  {sku:'FenderAudiA4B8front',minPrice:2000},
  {sku:'DAK123456',minPrice:5000},
  {sku:'DAK-VASE-SHELL-ASA-WH-001',minPrice:5000},
];

function env(name:string){return process.env[name]?.trim()||null}

async function fetchJson(url:string,init:RequestInit={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),Number(process.env.MARKETPLACE_API_TIMEOUT_MS||15000));
  try{
    const response=await fetch(url,{...init,signal:controller.signal,cache:'no-store'});
    const text=await response.text();
    let data:any={};
    try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
    if(!response.ok){
      const error:any=new Error(String(data?.message||data?.errorText||data?.error||data?.errors?.[0]?.message||`HTTP_${response.status}`));
      error.status=response.status;
      throw error;
    }
    return data;
  }finally{clearTimeout(timeout)}
}

type WbGood={
  nmID:number;
  vendorCode?:string;
  sizes?:Array<{sizeID?:number;price?:number;discountedPrice?:number;clubDiscountedPrice?:number}>;
  price?:number;
  discountedPrice?:number;
  editableSizePrice?:boolean;
};

async function loadWbGoods(token:string){
  const all:WbGood[]=[];
  const limit=1000;
  for(let page=0;page<20;page++){
    const offset=page*limit;
    const qs=new URLSearchParams({limit:String(limit),offset:String(offset)});
    const data=await fetchJson(`https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?${qs}`,{
      headers:{Authorization:token,'Content-Type':'application/json'}
    });
    const list=(data?.data?.listGoods||data?.listGoods||[]) as WbGood[];
    all.push(...list);
    if(list.length<limit)break;
  }
  return all;
}

function wbCurrentPrice(good:WbGood){
  const sizePrices=(Array.isArray(good.sizes)?good.sizes:[])
    .map(s=>Number(s?.discountedPrice??s?.price??0))
    .filter(n=>Number.isFinite(n)&&n>0);
  if(sizePrices.length)return Math.round(Math.min(...sizePrices));
  const direct=Number(good.discountedPrice??good.price??0);
  return Number.isFinite(direct)&&direct>0?Math.round(direct):0;
}

async function guardWb(rule:PriceGuardRule,token:string|null,goods:WbGood[]|null,loadError:string|null){
  if(!token)return {marketplace:'wb',sku:rule.sku,status:'skipped',reason:'WB_API_TOKEN_NOT_CONFIGURED'};
  if(loadError)return {marketplace:'wb',sku:rule.sku,status:'error',error:loadError};
  const good=(goods||[]).find(g=>String(g.vendorCode||'').trim()===rule.sku);
  if(!good)return {marketplace:'wb',sku:rule.sku,status:'not_found'};

  const current=wbCurrentPrice(good);
  if(!current)return {marketplace:'wb',sku:rule.sku,status:'unknown_price',nmID:Number(good.nmID)||null};
  if(current>=rule.minPrice)return {marketplace:'wb',sku:rule.sku,status:'ok',price:current,minPrice:rule.minPrice,nmID:Number(good.nmID)||null};

  const nmID=Number(good.nmID);
  if(!Number.isFinite(nmID)||nmID<=0)return {marketplace:'wb',sku:rule.sku,status:'error',error:'WB_NMID_NOT_FOUND'};

  if(good.editableSizePrice===true){
    const sizeRows=(Array.isArray(good.sizes)?good.sizes:[])
      .filter(s=>Number.isFinite(Number(s?.sizeID))&&Number(s?.sizeID)>0)
      .map(s=>({nmID,sizeID:Number(s.sizeID),price:rule.minPrice}));
    if(!sizeRows.length)return {marketplace:'wb',sku:rule.sku,status:'error',error:'WB_SIZE_IDS_NOT_FOUND',nmID};
    const upload=await fetchJson('https://discounts-prices-api.wildberries.ru/api/v2/upload/task/size',{
      method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({data:sizeRows})
    });
    return {marketplace:'wb',sku:rule.sku,status:'raised',from:current,to:rule.minPrice,minPrice:rule.minPrice,nmID,mode:'size',uploadId:upload?.data?.id??null,pending:true};
  }

  const upload=await fetchJson('https://discounts-prices-api.wildberries.ru/api/v2/upload/task',{
    method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({data:[{nmID,price:rule.minPrice,discount:0}]})
  });
  return {marketplace:'wb',sku:rule.sku,status:'raised',from:current,to:rule.minPrice,minPrice:rule.minPrice,nmID,mode:'product',uploadId:upload?.data?.id??null,pending:true};
}

async function ozonInfo(rule:PriceGuardRule){
  const clientId=env('OZON_CLIENT_ID'),apiKey=env('OZON_API_KEY');
  if(!clientId||!apiKey)return {configured:false as const};
  const headers={'Client-Id':clientId,'Api-Key':apiKey,'Content-Type':'application/json'};
  const data=await fetchJson('https://api-seller.ozon.ru/v3/product/info/list',{
    method:'POST',headers,
    body:JSON.stringify({offer_id:[rule.sku],product_id:[],sku:[]})
  });
  const item=(data?.items||data?.result?.items||[])[0]||null;
  return {configured:true as const,headers,item};
}

async function guardOzon(rule:PriceGuardRule){
  const info=await ozonInfo(rule);
  if(!info.configured)return {marketplace:'ozon',sku:rule.sku,status:'skipped',reason:'OZON_NOT_CONFIGURED'};
  const item=info.item;
  if(!item)return {marketplace:'ozon',sku:rule.sku,status:'not_found'};

  const current=Math.round(Number(item.price??item.marketing_price??item.min_ozon_price??0));
  if(!current)return {marketplace:'ozon',sku:rule.sku,status:'unknown_price'};
  if(current>=rule.minPrice)return {marketplace:'ozon',sku:rule.sku,status:'ok',price:current,minPrice:rule.minPrice};

  await fetchJson('https://api-seller.ozon.ru/v1/product/import/prices',{
    method:'POST',headers:info.headers,
    body:JSON.stringify({prices:[{offer_id:rule.sku,price:String(rule.minPrice),old_price:'0',premium_price:'0'}]})
  });

  return {marketplace:'ozon',sku:rule.sku,status:'raised',from:current,to:rule.minPrice,minPrice:rule.minPrice,pending:true};
}

export async function runPriceGuard(){
  if(process.env.PRICE_GUARD_ENABLED==='0')return {enabled:false,checkedAt:new Date().toISOString(),raised:0,results:[] as any[]};
  const results:any[]=[];

  const wbToken=env('WB_API_TOKEN');
  let wbGoods:WbGood[]|null=null;
  let wbLoadError:string|null=null;
  if(wbToken){
    try{wbGoods=await loadWbGoods(wbToken)}catch(e:any){wbLoadError=String(e?.message||e)}
  }

  for(const rule of RULES){
    try{results.push(await guardWb(rule,wbToken,wbGoods,wbLoadError))}catch(e:any){results.push({marketplace:'wb',sku:rule.sku,status:'error',error:String(e?.message||e)})}
    try{results.push(await guardOzon(rule))}catch(e:any){results.push({marketplace:'ozon',sku:rule.sku,status:'error',error:String(e?.message||e)})}
  }
  const raised=results.filter(r=>r.status==='raised');
  if(raised.length)console.warn('[price-guard] restored prices',JSON.stringify(raised));
  return {enabled:true,checkedAt:new Date().toISOString(),raised:raised.length,results};
}

export function getPriceGuardRules(){return RULES.map(r=>({...r}))}
