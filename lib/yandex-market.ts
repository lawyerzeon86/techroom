import { ensureSchema, getPool } from './db';
import { yandexRequest, yandexPages, yandexId, yandexFbsCampaign } from './yandex-api';

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
  return Boolean(process.env.YANDEX_MARKET_API_KEY?.trim()&&process.env.YANDEX_MARKET_BUSINESS_ID?.trim()&&process.env.YANDEX_MARKET_CAMPAIGN_ID?.trim());
}

export async function testYandexMarket(){
  const campaign=await yandexFbsCampaign();
  const campaignId=Number(yandexId('YANDEX_MARKET_CAMPAIGN_ID'));
  await yandexRequest(`/v1/businesses/${yandexId('YANDEX_MARKET_BUSINESS_ID')}/orders?limit=1`,{fake:false,sourcePlatforms:['MARKET'],campaignIds:[campaignId],programTypes:['FBS']});
  return {ok:true,campaign:{id:campaign.id,name:campaign.domain,model:campaign.placementType,apiAvailability:campaign.apiAvailability}};
}

export async function syncYandexMarketOrders(){
  env('YANDEX_MARKET_API_KEY');
  const businessId=env('YANDEX_MARKET_BUSINESS_ID');
  const campaignId=Number(env('YANDEX_MARKET_CAMPAIGN_ID'));
  await yandexFbsCampaign();
  let total=0;
  const orders=await yandexPages(`/v1/businesses/${encodeURIComponent(businessId)}/orders`,'orders',{fake:false,sourcePlatforms:['MARKET'],campaignIds:[campaignId],programTypes:['FBS']},50);
    for(const o of orders){
      if(!o.orderId)throw new Error('YANDEX_ORDER_ID_MISSING');
      const items=(Array.isArray(o.items)?o.items:[]).map((x:any)=>({
        sku:x.offerId??null,
        offerId:x.offerId??null,
        name:x.offerName??x.name??'',
        quantity:Number(x.count??x.quantity??1)||1,
        price:asNumber(x?.prices?.payment??x?.buyerPrice??x?.price),
      }));
      // Business API item payment is the line total, rather than a unit price.
      for(const item of items)item.price=item.price/item.quantity;
      const itemTotal=items.reduce((s:number,x:any)=>s+Number(x.price)*Number(x.quantity),0);
      const orderTotal=o?.prices?.payment==null?itemTotal:asNumber(o.prices.payment);
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
      total++;
  }
  return {synced:total};
}
