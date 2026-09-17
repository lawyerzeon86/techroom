export type PriceGuardRule={sku:string;minPrice:number};

const RULES:PriceGuardRule[]=[
  {sku:'R8W0821653',minPrice:2000},
  {sku:'DAK8T54A53A',minPrice:2000},
  {sku:'FenderAudiA4B8front',minPrice:2000},
  {sku:'DAK123456',minPrice:5000},
  {sku:'DAK-VASE-SHELL-ASA-WH-001',minPrice:5000},
];

function env(name:string){return process.env[name]?.trim()||null}
function timeoutMs(){return Math.max(3000,Number(process.env.MARKETPLACE_API_TIMEOUT_MS||15000))}
function delay(ms:number){return new Promise(resolve=>setTimeout(resolve,ms))}

async function fetchJson(url:string,init:RequestInit={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutMs());
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

type WbLoadState={goods:WbGood[];rateLimitedUntil?:string;error?:string};

const wbNmIdCache=new Map<string,number|null>();
let wbBlockedUntil=0;

function parseRetryMs(response:Response){
  const raw=response.headers.get('x-ratelimit-retry')||response.headers.get('retry-after')||'';
  const fallback=Math.max(60000,Number(process.env.PRICE_GUARD_WB_BACKOFF_MS||180000));
  if(!raw)return fallback;
  const numeric=Number(raw);
  if(Number.isFinite(numeric)&&numeric>0){
    if(numeric>1e12)return Math.max(1000,numeric-Date.now());
    if(numeric>1e9)return Math.max(1000,numeric*1000-Date.now());
    return Math.max(1000,numeric*1000);
  }
  const parsed=Date.parse(raw);
  return Number.isFinite(parsed)?Math.max(1000,parsed-Date.now()):fallback;
}

async function wbRequest(url:string,init:RequestInit={}){
  if(Date.now()<wbBlockedUntil){
    const error:any=new Error('WB_RATE_LIMITED');
    error.status=429;
    error.retryAt=wbBlockedUntil;
    throw error;
  }
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutMs());
  try{
    const response=await fetch(url,{...init,signal:controller.signal,cache:'no-store'});
    const text=await response.text();
    let data:any={};
    try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
    if(response.status===429){
      wbBlockedUntil=Date.now()+parseRetryMs(response);
      const error:any=new Error('WB_RATE_LIMITED');
      error.status=429;
      error.retryAt=wbBlockedUntil;
      throw error;
    }
    if(!response.ok){
      const error:any=new Error(String(data?.message||data?.errorText||data?.error||`WB_HTTP_${response.status}`));
      error.status=response.status;
      throw error;
    }
    return data;
  }finally{clearTimeout(timeout)}
}

async function resolveWbNmId(token:string,sku:string){
  if(wbNmIdCache.has(sku))return wbNmIdCache.get(sku)??null;
  const body={settings:{cursor:{limit:100},filter:{textSearch:sku,withPhoto:-1},sort:{ascending:false}}};
  const data=await fetchJson('https://content-api.wildberries.ru/content/v2/get/cards/list',{
    method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify(body)
  });
  const cards=Array.isArray(data?.cards)?data.cards:[];
  const exact=cards.find((card:any)=>String(card?.vendorCode||'').trim()===sku);
  const nmID=Number(exact?.nmID||0);
  const value=Number.isFinite(nmID)&&nmID>0?nmID:null;
  wbNmIdCache.set(sku,value);
  return value;
}

async function loadWbGoods(token:string):Promise<WbLoadState>{
  if(Date.now()<wbBlockedUntil)return {goods:[],rateLimitedUntil:new Date(wbBlockedUntil).toISOString()};
  const ids:number[]=[];
  try{
    for(const rule of RULES){
      const nmID=await resolveWbNmId(token,rule.sku);
      if(nmID)ids.push(nmID);
      await delay(80);
    }
    const unique=[...new Set(ids)];
    if(!unique.length)return {goods:[]};
    const data=await wbRequest('https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter',{
      method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({nmIDs:unique})
    });
    return {goods:(data?.data?.listGoods||data?.listGoods||[]) as WbGood[]};
  }catch(e:any){
    if(Number(e?.status)===429){
      const retryAt=Number(e?.retryAt||wbBlockedUntil||Date.now()+180000);
      wbBlockedUntil=Math.max(wbBlockedUntil,retryAt);
      return {goods:[],rateLimitedUntil:new Date(wbBlockedUntil).toISOString()};
    }
    return {goods:[],error:String(e?.message||e)};
  }
}

function wbCurrentPrice(good:WbGood){
  const sizePrices=(Array.isArray(good.sizes)?good.sizes:[])
    .map(s=>Number(s?.discountedPrice??s?.price??0))
    .filter(n=>Number.isFinite(n)&&n>0);
  if(sizePrices.length)return Math.round(Math.min(...sizePrices));
  const direct=Number(good.discountedPrice??good.price??0);
  return Number.isFinite(direct)&&direct>0?Math.round(direct):0;
}

async function guardWb(rule:PriceGuardRule,token:string|null,state:WbLoadState){
  if(!token)return {marketplace:'wb',sku:rule.sku,status:'skipped',reason:'WB_API_TOKEN_NOT_CONFIGURED'};
  if(state.rateLimitedUntil)return {marketplace:'wb',sku:rule.sku,status:'rate_limited',retryAt:state.rateLimitedUntil};
  if(state.error)return {marketplace:'wb',sku:rule.sku,status:'error',error:state.error};
  const nmID=wbNmIdCache.get(rule.sku)??null;
  if(!nmID)return {marketplace:'wb',sku:rule.sku,status:'not_found'};
  const good=state.goods.find(g=>Number(g.nmID)===Number(nmID));
  if(!good)return {marketplace:'wb',sku:rule.sku,status:'unknown_price',nmID};

  const current=wbCurrentPrice(good);
  if(!current)return {marketplace:'wb',sku:rule.sku,status:'unknown_price',nmID};
  if(current>=rule.minPrice)return {marketplace:'wb',sku:rule.sku,status:'ok',price:current,minPrice:rule.minPrice,nmID};

  try{
    if(good.editableSizePrice===true){
      const sizeRows=(Array.isArray(good.sizes)?good.sizes:[])
        .filter(s=>Number.isFinite(Number(s?.sizeID))&&Number(s?.sizeID)>0)
        .map(s=>({nmID,sizeID:Number(s.sizeID),price:rule.minPrice}));
      if(!sizeRows.length)return {marketplace:'wb',sku:rule.sku,status:'error',error:'WB_SIZE_IDS_NOT_FOUND',nmID};
      const upload=await wbRequest('https://discounts-prices-api.wildberries.ru/api/v2/upload/task/size',{
        method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({data:sizeRows})
      });
      return {marketplace:'wb',sku:rule.sku,status:'raised',from:current,to:rule.minPrice,minPrice:rule.minPrice,nmID,mode:'size',uploadId:upload?.data?.id??upload?.data?.uploadID??null,pending:true};
    }

    const upload=await wbRequest('https://discounts-prices-api.wildberries.ru/api/v2/upload/task',{
      method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({data:[{nmID,price:rule.minPrice,discount:0}]})
    });
    return {marketplace:'wb',sku:rule.sku,status:'raised',from:current,to:rule.minPrice,minPrice:rule.minPrice,nmID,mode:'product',uploadId:upload?.data?.id??upload?.data?.uploadID??null,pending:true};
  }catch(e:any){
    if(Number(e?.status)===429){
      const retryAt=Number(e?.retryAt||wbBlockedUntil||Date.now()+180000);
      wbBlockedUntil=Math.max(wbBlockedUntil,retryAt);
      return {marketplace:'wb',sku:rule.sku,status:'rate_limited',retryAt:new Date(wbBlockedUntil).toISOString()};
    }
    return {marketplace:'wb',sku:rule.sku,status:'error',error:String(e?.message||e),nmID};
  }
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
  const wbState=wbToken?await loadWbGoods(wbToken):{goods:[] as WbGood[]};

  for(const rule of RULES){
    try{results.push(await guardWb(rule,wbToken,wbState))}catch(e:any){results.push({marketplace:'wb',sku:rule.sku,status:'error',error:String(e?.message||e)})}
    try{results.push(await guardOzon(rule))}catch(e:any){results.push({marketplace:'ozon',sku:rule.sku,status:'error',error:String(e?.message||e)})}
  }
  const raised=results.filter(r=>r.status==='raised');
  if(raised.length)console.warn('[price-guard] restored prices',JSON.stringify(raised));
  return {enabled:true,checkedAt:new Date().toISOString(),raised:raised.length,wbRateLimitedUntil:wbBlockedUntil>Date.now()?new Date(wbBlockedUntil).toISOString():null,results};
}

export function getPriceGuardRules(){return RULES.map(r=>({...r}))}
