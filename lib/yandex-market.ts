import { ensureSchema, getPool } from './db';

function env(name:string){
  const value=process.env[name]?.trim();
  if(!value) throw new Error(`${name}_NOT_CONFIGURED`);
  return value;
}

function asNumber(value:any){
  if(value==null) return 0;
  if(typeof value==='number') return value;
  if(typeof value==='string') return Number(value)||0;
  if(typeof value==='object') return Number(value.value??value.amount??value.price??0)||0;
  return 0;
}

async function readJson(res:Response){
  const text=await res.text();
  let data:any={};
  try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
  if(!res.ok) throw new Error(String(data?.message||data?.error||data?.errors?.[0]?.message||`YANDEX_MARKET_HTTP_${res.status}`));
  return data;
}

async function upsert(order:any){
  await ensureSchema();
  const pool=getPool();
  await pool.query(`
    INSERT INTO marketplace_orders
      (source,external_id,order_number,status,total_amount,customer_name,phone,items,raw_payload,external_created_at,synced_at,updated_at)
    VALUES ('yandex_market',$1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,NOW(),NOW())
    ON CONFLICT(source,external_id) DO UPDATE SET
      order_number=EXCLUDED.order_number,
      status=EXCLUDED.status,
      total_amount=EXCLUDED.total_amount,
      customer_name=EXCLUDED.customer_name,
      phone=EXCLUDED.phone,
      items=EXCLUDED.items,
      raw_payload=EXCLUDED.raw_payload,
      external_created_at=COALESCE(EXCLUDED.external_created_at,marketplace_orders.external_created_at),
      synced_at=NOW(),updated_at=NOW()
  `,[order.externalId,order.orderNumber,order.status,order.totalAmount,order.customerName||null,order.phone||null,JSON.stringify(order.items),JSON.stringify(order.raw),order.createdAt||null]);
}

export function yandexMarketConfigured(){
  return Boolean(process.env.YANDEX_MARKET_API_KEY?.trim()&&process.env.YANDEX_MARKET_BUSINESS_ID?.trim());
}

export async function testYandexMarket(){
  const apiKey=env('YANDEX_MARKET_API_KEY');
  const res=await fetch('https://api.partner.market.yandex.ru/v2/auth/token',{
    method:'POST',headers:{'Api-Key':apiKey,'Content-Type':'application/json'},body:'{}',cache:'no-store'
  });
  const data=await readJson(res);
  return {ok:true,details:data?.status||'OK'};
}

export async function syncYandexMarketOrders(){
  const apiKey=env('YANDEX_MARKET_API_KEY');
  const businessId=env('YANDEX_MARKET_BUSINESS_ID');
  let pageToken='';
  let total=0;

  for(let page=0;page<20;page++){
    const qs=new URLSearchParams({limit:'50'});
    if(pageToken) qs.set('pageToken',pageToken);
    const url=`https://api.partner.market.yandex.ru/v1/businesses/${encodeURIComponent(businessId)}/orders?${qs.toString()}`;
    const res=await fetch(url,{
      method:'POST',
      headers:{'Api-Key':apiKey,'Content-Type':'application/json'},
      body:JSON.stringify({fake:false,sourcePlatforms:['MARKET']}),
      cache:'no-store'
    });
    const data=await readJson(res);
    const orders=Array.isArray(data?.orders)?data.orders:[];
    for(const o of orders){
      const items=(Array.isArray(o.items)?o.items:[]).map((x:any)=>({
        sku:x.offerId??null,
        offerId:x.offerId??null,
        name:x.offerName??x.name??'',
        quantity:Number(x.count??x.quantity??1)||1,
        price:asNumber(x?.prices?.payment??x?.buyerPrice??x?.price),
      }));
      const itemTotal=items.reduce((s:number,x:any)=>s+(Number(x.price)||0)*(Number(x.quantity)||1),0);
      const orderTotal=asNumber(o?.prices?.payment)||itemTotal;
      await upsert({
        externalId:String(o.orderId??o.externalOrderId??''),
        orderNumber:String(o.externalOrderId??o.orderId??''),
        status:String(o.status??o.substatus??'unknown'),
        totalAmount:Math.round(orderTotal),
        customerName:null,
        phone:null,
        items,
        raw:o,
        createdAt:o.creationDate??o.createdAt??null,
      });
    }
    total+=orders.length;
    const next=String(data?.paging?.nextPageToken??data?.nextPageToken??'');
    if(!next||next===pageToken) break;
    pageToken=next;
  }
  return {synced:total};
}
