import { listPriceSheet, setAvitoItemMappings } from './price-sheet';

let tokenCache:{token:string;expiresAt:number}|null=null;

function env(name:string){
  const value=process.env[name]?.trim();
  if(!value)throw new Error(name+'_NOT_CONFIGURED');
  return value;
}

async function readJson(res:Response){
  const text=await res.text();
  let data:any={};
  try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!res.ok){
    const message=data?.message||data?.error_description||data?.error||data?.errors?.[0]?.message||('AVITO_HTTP_'+res.status);
    const e:any=new Error(String(message));e.status=res.status;throw e;
  }
  return data;
}

export function avitoConfigured(){
  return Boolean(process.env.AVITO_CLIENT_ID?.trim()&&process.env.AVITO_CLIENT_SECRET?.trim());
}

export async function getAvitoToken(){
  if(tokenCache&&Date.now()<tokenCache.expiresAt-60000)return tokenCache.token;
  const body=new URLSearchParams({
    grant_type:'client_credentials',
    client_id:env('AVITO_CLIENT_ID'),
    client_secret:env('AVITO_CLIENT_SECRET'),
  });
  const res=await fetch('https://api.avito.ru/token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body,
    cache:'no-store'
  });
  const data=await readJson(res);
  const token=String(data?.access_token||'');
  if(!token)throw new Error('AVITO_TOKEN_MISSING');
  const expires=Math.max(300,Number(data?.expires_in)||86400);
  tokenCache={token,expiresAt:Date.now()+expires*1000};
  return token;
}

async function avitoFetch(path:string,init:RequestInit={}){
  const token=await getAvitoToken();
  return fetch('https://api.avito.ru'+path,{
    ...init,
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(init.headers||{})},
    cache:'no-store'
  });
}

export async function testAvito(){
  const res=await avitoFetch('/core/v1/items?per_page=1&page=1&status=active');
  const data=await readJson(res);
  const total=Number(data?.meta?.total)||Number(data?.meta?.items)||0;
  return {ok:true,details:'OK',activeItems:total};
}

export async function resolveAvitoItemIdsBySku(skus:string[]){
  const unique=[...new Set(skus.map(s=>String(s).trim()).filter(Boolean))];
  const mappings:Array<{sku:string;itemId:number}>=[];
  for(let i=0;i<unique.length;i+=50){
    const part=unique.slice(i,i+50);
    const qs=new URLSearchParams({query:part.join(',')});
    try{
      const res=await avitoFetch('/autoload/v2/items/avito_ids?'+qs.toString(),{headers:{}});
      const data=await readJson(res);
      for(const item of Array.isArray(data?.items)?data.items:[]){
        const sku=String(item?.ad_id||'').trim();
        const itemId=Number(item?.avito_id||0);
        if(sku&&Number.isSafeInteger(itemId)&&itemId>0)mappings.push({sku,itemId});
      }
    }catch(e:any){
      if(Number(e?.status)===403||Number(e?.status)===404)break;
      throw e;
    }
  }
  if(mappings.length)await setAvitoItemMappings(mappings);
  return mappings;
}

export async function pushAvitoPrices(){
  if(!avitoConfigured())return {status:'skipped',reason:'AVITO_NOT_CONFIGURED',mapped:0,updated:0,errors:[] as any[]};
  const items=await listPriceSheet();
  const enabled=items.filter((x:any)=>x.syncAvito&&x.price>0);
  if(!enabled.length)return {status:'ok',mapped:0,updated:0,errors:[] as any[]};

  const unresolved=enabled.filter((x:any)=>!x.avitoItemId).map((x:any)=>x.sku);
  if(unresolved.length){
    try{await resolveAvitoItemIdsBySku(unresolved)}catch(e:any){
      console.warn('[avito] autoload mapping failed',String(e?.message||e));
    }
  }

  const fresh=await listPriceSheet();
  const currentRes=await avitoFetch('/core/v1/items?per_page=99&page=1&status=active');
  const currentJson=await readJson(currentRes);
  const currentById=new Map<number,number>();
  for(const item of Array.isArray(currentJson?.resources)?currentJson.resources:[]){
    const id=Number(item?.id||0),price=Math.round(Number(item?.price)||0);
    if(id>0)currentById.set(id,price);
  }

  let mapped=0,updated=0;
  const errors:any[]=[];
  for(const p of fresh.filter((x:any)=>x.syncAvito&&x.price>0)){
    const itemId=Number((p as any).avitoItemId||0);
    if(!itemId){errors.push({sku:p.sku,code:'AVITO_ITEM_NOT_MAPPED'});continue}
    mapped++;
    const target=Math.max(1,Math.round(Number(p.price)||0),Math.round(Number(p.minPrice)||0));
    const current=currentById.get(itemId);
    if(current&&current===target)continue;
    try{
      const res=await avitoFetch('/core/v1/items/'+encodeURIComponent(String(itemId))+'/update_price',{
        method:'POST',
        body:JSON.stringify({price:target})
      });
      await readJson(res);
      updated++;
    }catch(e:any){
      errors.push({sku:p.sku,itemId,code:'AVITO_PRICE_UPDATE_FAILED',error:String(e?.message||e)});
    }
  }
  return {status:'ok',mapped,updated,errors};
}
