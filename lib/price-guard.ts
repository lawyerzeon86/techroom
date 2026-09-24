export type PriceGuardRule={sku:string;minPrice:number};

const OZON_PROMO_FLOOR_SKUS=new Set(['R8W0821653','8W0821653','DAK8T54A53A','FenderAudiA4B8front']);
const OZON_KNOWN_AUTO_SKUS=new Set(['R8W0821653','DAK8T54A53A','FenderAudiA4B8front']);
const OZON_AUTO_PROMO_FLOOR=2990;

const RULES:PriceGuardRule[]=[
  {sku:'R8W0821653',minPrice:2990},
  {sku:'8W0821653',minPrice:2990},
  {sku:'DAK8T54A53A',minPrice:2990},
  {sku:'FenderAudiA4B8front',minPrice:2990},
  {sku:'DAK123456',minPrice:5000},
  {sku:'DAK-VASE-SHELL-ASA-WH-001',minPrice:5000},
];

let ozonAutoRuleCache:{expiresAt:number;rules:PriceGuardRule[]}|null=null;

async function loadOzonAutoPromoRules():Promise<PriceGuardRule[]>{
  if(ozonAutoRuleCache&&Date.now()<ozonAutoRuleCache.expiresAt)return ozonAutoRuleCache.rules;
  const fallback=[...OZON_KNOWN_AUTO_SKUS].map(sku=>({sku,minPrice:OZON_AUTO_PROMO_FLOOR}));
  try{
    const clientId=env('OZON_CLIENT_ID'),apiKey=env('OZON_API_KEY');
    if(!clientId||!apiKey)return fallback;
    const headers={'Client-Id':clientId,'Api-Key':apiKey,'Content-Type':'application/json'};
    const list=await fetchJson('https://api-seller.ozon.ru/v3/product/list',{
      method:'POST',headers,body:JSON.stringify({filter:{visibility:'ALL'},last_id:'',limit:1000})
    });
    const listItems=list?.result?.items||list?.items||[];
    const offerIds=[...new Set(listItems.map((p:any)=>String(p?.offer_id||'').trim()).filter(Boolean))];
    const seen=new Set<string>(OZON_KNOWN_AUTO_SKUS);
    if(offerIds.length){
      const info=await fetchJson('https://api-seller.ozon.ru/v3/product/info/list',{
        method:'POST',headers,body:JSON.stringify({offer_id:offerIds,product_id:[],sku:[]})
      });
      const items=info?.items||info?.result?.items||[];
      const autoPattern=/(audi|bmw|mercedes|porsche|авто|автомоб|порог|наклад|датчик|кожух|запчаст|fender|8w0821653|a4\s*b9|a4\s*b8)/i;
      for(const item of items){
        const offerId=String(item?.offer_id||'').trim();
        const text=`${item?.name||''} ${offerId}`;
        if(offerId&&autoPattern.test(text))seen.add(offerId);
      }
    }
    const rules=[...seen].map(sku=>({sku,minPrice:OZON_AUTO_PROMO_FLOOR}));
    ozonAutoRuleCache={expiresAt:Date.now()+60*60*1000,rules};
    console.log('[price-guard] Ozon auto promo SKUs',JSON.stringify(rules.map(r=>r.sku)));
    return rules;
  }catch(e:any){
    console.warn('[price-guard] Ozon auto SKU discovery failed',String(e?.message||e));
    return fallback;
  }
}

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
let wbNextCheckAt=0;
const WB_DEFAULT_CHECK_INTERVAL_MS=16*60*1000;

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
  if(value)wbNmIdCache.set(sku,value);
  else wbNmIdCache.delete(sku);
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
      method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({nmList:unique})
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

async function enforceOzonAutoActionsDisabled(){
  const clientId=env('OZON_CLIENT_ID'),apiKey=env('OZON_API_KEY');
  if(!clientId||!apiKey)return {configured:false,checked:0,disabled:0,errors:[] as any[]};
  const headers={'Client-Id':clientId,'Api-Key':apiKey,'Content-Type':'application/json'};
  const items:any[]=[];
  let cursor='';
  for(let page=0;page<20;page++){
    const data=await fetchJson('https://api-seller.ozon.ru/v5/product/info/prices',{
      method:'POST',headers,
      body:JSON.stringify({cursor,filter:{visibility:'ALL'},limit:1000})
    });
    const pageItems=Array.isArray(data?.items)?data.items:[];
    items.push(...pageItems);
    const next=String(data?.cursor||'').trim();
    if(!next||next===cursor||pageItems.length===0)break;
    cursor=next;
  }

  const enabled=items.filter((item:any)=>item?.price?.auto_action_enabled===true);
  const errors:any[]=[];
  let disabled=0;

  for(let i=0;i<enabled.length;i+=1000){
    const part=enabled.slice(i,i+1000);
    const prices=part.map((item:any)=>{
      const price=item?.price||{};
      return {
        offer_id:String(item?.offer_id||''),
        price:String(price?.price??0),
        old_price:String(price?.old_price??0),
        min_price:String(price?.min_price??0),
        currency_code:String(price?.currency_code||'RUB'),
        auto_action_enabled:'DISABLED'
      };
    }).filter((x:any)=>x.offer_id&&Number(x.price)>0);

    if(!prices.length)continue;
    const data=await fetchJson('https://api-seller.ozon.ru/v1/product/import/prices',{
      method:'POST',headers,body:JSON.stringify({prices})
    });
    for(const result of Array.isArray(data?.result)?data.result:[]){
      if(result?.updated===true)disabled++;
      for(const e of Array.isArray(result?.errors)?result.errors:[]){
        errors.push({offerId:result?.offer_id,code:e?.code,message:e?.message});
      }
    }
  }

  return {configured:true,checked:items.length,enabledBefore:enabled.length,disabled,errors};
}

async function guardOzon(rule:PriceGuardRule,promoFloor=false){
  let info=await ozonInfo(rule);
  if(!info.configured)return {marketplace:'ozon',sku:rule.sku,status:'skipped',reason:'OZON_NOT_CONFIGURED'};
  if(!info.item)return {marketplace:'ozon',sku:rule.sku,status:'not_found'};

  if(promoFloor){
    const maxAttempts=Math.min(10,Math.max(1,Number(process.env.PRICE_GUARD_OZON_RETRIES||6)));
    const retryDelayMs=Math.min(10000,Math.max(750,Number(process.env.PRICE_GUARD_OZON_RETRY_DELAY_MS||2000)));
    let initialSellerPrice=0;
    let initialPromoMin=0;
    let changed=false;
    let writes=0;

    for(let attempt=1;attempt<=maxAttempts;attempt++){
      const item=info.item;
      if(!item)return {marketplace:'ozon',sku:rule.sku,status:'not_found',attempts:attempt-1};

      const sellerPrice=Math.round(Number(item.price??item.marketing_price??item.min_ozon_price??0));
      const promoMin=Math.round(Number(item.min_price??item.min_ozon_price??0));
      if(!initialSellerPrice)initialSellerPrice=sellerPrice;
      if(!initialPromoMin)initialPromoMin=promoMin;
      if(!sellerPrice)return {marketplace:'ozon',sku:rule.sku,status:'unknown_price',attempts:attempt-1};

      if(sellerPrice>=rule.minPrice&&promoMin===rule.minPrice){
        if(changed){
          await delay(retryDelayMs);
          const confirm=await ozonInfo(rule);
          if(!confirm.configured)return {marketplace:'ozon',sku:rule.sku,status:'skipped',reason:'OZON_NOT_CONFIGURED'};
          const confirmItem=confirm.item;
          if(!confirmItem)return {marketplace:'ozon',sku:rule.sku,status:'not_found',attempts:writes};
          const confirmSeller=Math.round(Number(confirmItem.price??confirmItem.marketing_price??confirmItem.min_ozon_price??0));
          const confirmPromo=Math.round(Number(confirmItem.min_price??confirmItem.min_ozon_price??0));
          if(confirmSeller>=rule.minPrice&&confirmPromo===rule.minPrice){
            return {marketplace:'ozon',sku:rule.sku,status:'raised',from:initialSellerPrice,to:confirmSeller,fromPromoMin:initialPromoMin,toPromoMin:confirmPromo,minPromoPrice:rule.minPrice,mode:'promo_floor',verified:true,attempts:writes};
          }
          console.warn('[price-guard] Ozon promo floor changed after update',JSON.stringify({sku:rule.sku,attempt,sellerPrice:confirmSeller,promoMin:confirmPromo,target:rule.minPrice}));
          info=confirm;
          continue;
        }
        return {marketplace:'ozon',sku:rule.sku,status:'ok',price:sellerPrice,promoMinPrice:promoMin,minPromoPrice:rule.minPrice,mode:'promo_floor',verified:true,attempts:0};
      }

      const targetSellerPrice=sellerPrice===promoMin&&sellerPrice>rule.minPrice?rule.minPrice:Math.max(sellerPrice,rule.minPrice);
      console.warn('[price-guard] Ozon promo floor retry',JSON.stringify({sku:rule.sku,attempt,sellerPrice,promoMin,targetSellerPrice,targetPromoMin:rule.minPrice}));

      const data=await fetchJson('https://api-seller.ozon.ru/v1/product/import/prices',{
        method:'POST',headers:info.headers,
        body:JSON.stringify({prices:[{
          offer_id:rule.sku,
          price:String(targetSellerPrice),
          min_price:String(rule.minPrice),
          min_price_for_auto_actions_enabled:true,
          auto_action_enabled:'DISABLED',
          old_price:String(item.old_price??'0'),
          currency_code:String(item.currency_code||'RUB')
        }]})
      });
      const result=(data?.result||[])[0]||{};
      if(result?.updated===false||Array.isArray(result?.errors)&&result.errors.length){
        const message=(result?.errors||[]).map((e:any)=>e?.message||e?.code).filter(Boolean).join('; ')||'OZON_PRICE_UPDATE_REJECTED';
        throw new Error(message);
      }

      changed=true;
      writes++;
      await delay(retryDelayMs);
      info=await ozonInfo(rule);
      if(!info.configured)return {marketplace:'ozon',sku:rule.sku,status:'skipped',reason:'OZON_NOT_CONFIGURED'};
    }

    const finalItem=info.item;
    const finalSeller=Math.round(Number(finalItem?.price??finalItem?.marketing_price??finalItem?.min_ozon_price??0));
    const finalPromo=Math.round(Number(finalItem?.min_price??finalItem?.min_ozon_price??0));
    return {marketplace:'ozon',sku:rule.sku,status:'retry_pending',from:initialSellerPrice,price:finalSeller,fromPromoMin:initialPromoMin,promoMinPrice:finalPromo,minPromoPrice:rule.minPrice,mode:'promo_floor',verified:false,attempts:writes};
  }

  const item=info.item;
  const sellerPrice=Math.round(Number(item.price??item.marketing_price??item.min_ozon_price??0));
  if(!sellerPrice)return {marketplace:'ozon',sku:rule.sku,status:'unknown_price'};
  if(sellerPrice>=rule.minPrice)return {marketplace:'ozon',sku:rule.sku,status:'ok',price:sellerPrice,minPrice:rule.minPrice};

  await fetchJson('https://api-seller.ozon.ru/v1/product/import/prices',{
    method:'POST',headers:info.headers,
    body:JSON.stringify({prices:[{offer_id:rule.sku,price:String(rule.minPrice),old_price:'0',auto_action_enabled:'DISABLED'}]})
  });

  return {marketplace:'ozon',sku:rule.sku,status:'raised',from:sellerPrice,to:rule.minPrice,minPrice:rule.minPrice,pending:true};
}

export async function runPriceGuard(){
  if(process.env.PRICE_GUARD_ENABLED==='0')return {enabled:false,checkedAt:new Date().toISOString(),raised:0,results:[] as any[]};
  const results:any[]=[];

  // Keep auto-participation in Ozon promotions disabled for the entire catalog.
  try{
    const autoActions=await enforceOzonAutoActionsDisabled();
    results.push({marketplace:'ozon',scope:'all',status:'auto_actions_guard',...autoActions});
    if(autoActions.disabled)console.warn('[price-guard] disabled Ozon auto actions',JSON.stringify(autoActions));
  }catch(e:any){
    results.push({marketplace:'ozon',scope:'all',status:'auto_actions_error',error:String(e?.message||e)});
  }

  // Ozon is checked first so WB rate limits or slow responses cannot delay the automotive promo floor.
  const ozonAutoRules=await loadOzonAutoPromoRules();
  for(const rule of ozonAutoRules){
    try{results.push(await guardOzon(rule,true))}catch(e:any){results.push({marketplace:'ozon',sku:rule.sku,status:'error',error:String(e?.message||e)})}
  }
  for(const rule of RULES.filter(r=>!OZON_PROMO_FLOOR_SKUS.has(r.sku))){
    try{results.push(await guardOzon(rule,false))}catch(e:any){results.push({marketplace:'ozon',sku:rule.sku,status:'error',error:String(e?.message||e)})}
  }

  const wbToken=env('WB_API_TOKEN');
  const wbInterval=Math.max(60*1000,Number(process.env.PRICE_GUARD_WB_INTERVAL_MS||WB_DEFAULT_CHECK_INTERVAL_MS));
  if(!wbToken){
    for(const rule of RULES)results.push({marketplace:'wb',sku:rule.sku,status:'skipped',reason:'WB_API_TOKEN_NOT_CONFIGURED'});
  }else if(Date.now()<Math.max(wbBlockedUntil,wbNextCheckAt)){
    const retryAt=Math.max(wbBlockedUntil,wbNextCheckAt);
    for(const rule of RULES)results.push({marketplace:'wb',sku:rule.sku,status:'cooldown',retryAt:new Date(retryAt).toISOString()});
  }else{
    const wbState=await loadWbGoods(wbToken);
    const parsedRetry=wbState.rateLimitedUntil?Date.parse(wbState.rateLimitedUntil):0;
    wbNextCheckAt=Math.max(Date.now()+wbInterval,Number.isFinite(parsedRetry)?parsedRetry:0);
    for(const rule of RULES){
      try{results.push(await guardWb(rule,wbToken,wbState))}catch(e:any){results.push({marketplace:'wb',sku:rule.sku,status:'error',error:String(e?.message||e)})}
    }
  }

  const raised=results.filter(r=>r.status==='raised');
  if(raised.length)console.warn('[price-guard] restored prices',JSON.stringify(raised));
  return {enabled:true,checkedAt:new Date().toISOString(),raised:raised.length,wbRateLimitedUntil:wbBlockedUntil>Date.now()?new Date(wbBlockedUntil).toISOString():null,results};
}

export function getPriceGuardRules(){return RULES.map(r=>({...r}))}
