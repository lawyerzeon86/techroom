const BASE='https://api.partner.market.yandex.ru';

export function yandexId(name:string){
  const value=process.env[name]?.trim();
  if(!value||!/^\d+$/.test(value)||Number(value)<1)throw new Error(`${name}_NOT_CONFIGURED`);
  return value;
}

export async function yandexRequest(path:string,body?:unknown,method=body===undefined?'GET':'POST'){
  const key=process.env.YANDEX_MARKET_API_KEY?.trim();
  if(!key)throw new Error('YANDEX_MARKET_API_KEY_NOT_CONFIGURED');
  if(!path.startsWith('/v'))throw new Error('INVALID_YANDEX_PATH');
  const response=await fetch(BASE+path,{method,headers:{'Api-Key':key,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',signal:AbortSignal.timeout(20000)});
  const raw=await response.text();
  let data:any;
  try{data=raw?JSON.parse(raw):{}}catch{throw new Error(`YANDEX_INVALID_RESPONSE_${response.status}`)}
  const errors=[...(Array.isArray(data.errors)?data.errors:[]),
    ...(Array.isArray(data.result?.results)?data.result.results.flatMap((x:any)=>(x.errors||[]).map((e:any)=>({...e,offerId:x.offerId}))):[])];
  if(!response.ok||data.status==='ERROR'||errors.length){
    const detail=errors.map((e:any)=>`${e.offerId?e.offerId+': ':''}${e.message||e.code||e.type||'error'}`).join('; ')||data.message||`HTTP_${response.status}`;
    throw new Error(`YANDEX: ${String(detail).split(key).join('[hidden]').slice(0,1200)}`);
  }
  return data;
}

export async function yandexPages(path:string,field:string,body?:unknown,limit=100){
  const items:any[]=[];let token='';const seen=new Set<string>();
  for(let page=0;page<1000;page++){
    const query=new URLSearchParams({limit:String(limit)});if(token)query.set('pageToken',token);
    const data=await yandexRequest(`${path}?${query}`,body);
    const result=data.result??data;
    if(!Array.isArray(result[field]))throw new Error(`YANDEX_INVALID_${field.toUpperCase()}_RESPONSE`);
    items.push(...result[field]);
    const next=String(result.paging?.nextPageToken??'');
    if(!next)return items;
    if(seen.has(next))throw new Error('YANDEX_PAGINATION_LOOP');
    seen.add(next);token=next;
  }
  throw new Error('YANDEX_PAGINATION_LIMIT');
}

export async function yandexCampaigns(){
  const businessId=yandexId('YANDEX_MARKET_BUSINESS_ID');
  const campaigns=await yandexPages('/v2/campaigns','campaigns');
  return campaigns.filter((c:any)=>String(c.business?.id)===businessId);
}

export async function yandexFbsCampaign(){
  const campaignId=yandexId('YANDEX_MARKET_CAMPAIGN_ID');
  const campaigns=await yandexCampaigns();
  const campaign=campaigns.find((c:any)=>String(c.id)===campaignId);
  if(!campaign)throw new Error('YANDEX_FBS_CAMPAIGN_NOT_ACCESSIBLE');
  if(String(campaign.placementType||'').toUpperCase()!=='FBS')throw new Error('YANDEX_CAMPAIGN_IS_NOT_FBS');
  return campaign;
}

export async function yandexCatalog(){
  return yandexPages(`/v2/businesses/${yandexId('YANDEX_MARKET_BUSINESS_ID')}/offer-mappings`,'offerMappings',{});
}

export async function yandexBusinessSettings(){
  const data=await yandexRequest(`/v2/businesses/${yandexId('YANDEX_MARKET_BUSINESS_ID')}/settings`,{});
  return data.result?.settings??data.settings??{};
}

export async function yandexUpdatePrices(offers:any[]){
  await yandexFbsCampaign();
  const unique=new Set(offers.map(o=>o.offerId));
  if(unique.size!==offers.length)throw new Error('YANDEX_DUPLICATE_SKU');
  if(offers.some(o=>!o.offerId||!Number.isFinite(o.price?.value)||o.price.value<=0))throw new Error('YANDEX_INVALID_PRICE');
  const campaignId=yandexId('YANDEX_MARKET_CAMPAIGN_ID');
  for(let i=0;i<offers.length;i+=500)await yandexRequest(`/v2/campaigns/${campaignId}/offer-prices/updates`,{offers:offers.slice(i,i+500)});
  return {requested:offers.length,accepted:offers.length};
}

export async function yandexUpdateStocks(stocks:{sku:string;count:number}[]){
  await yandexFbsCampaign();
  const unique=new Set(stocks.map(x=>x.sku));
  if(unique.size!==stocks.length)throw new Error('YANDEX_DUPLICATE_SKU');
  if(stocks.some(x=>!x.sku||!Number.isInteger(x.count)||x.count<0))throw new Error('YANDEX_INVALID_STOCK');
  const campaignId=yandexId('YANDEX_MARKET_CAMPAIGN_ID');
  const updatedAt=new Date().toISOString();
  for(let i=0;i<stocks.length;i+=2000){
    const skus=stocks.slice(i,i+2000).map(x=>({sku:x.sku,items:[{count:x.count,updatedAt}]}));
    await yandexRequest(`/v2/campaigns/${campaignId}/offers/stocks`,{skus},'PUT');
  }
  return {requested:stocks.length,accepted:stocks.length};
}
