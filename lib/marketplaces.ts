import { ensureSchema, getPool } from './db';

export type MarketplaceName = 'wildberries' | 'ozon';

function env(name:string){
  const value=process.env[name]?.trim();
  if(!value) throw new Error(`${name}_NOT_CONFIGURED`);
  return value;
}

async function readJson(res:Response){
  const text=await res.text();
  let data:any={};
  try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
  if(!res.ok){
    const message=data?.message||data?.error||data?.errors?.[0]?.message||`HTTP_${res.status}`;
    throw new Error(String(message));
  }
  return data;
}

export function marketplaceConfig(){
  return {
    wildberries:Boolean(process.env.WB_API_TOKEN?.trim()),
    ozon:Boolean(process.env.OZON_CLIENT_ID?.trim()&&process.env.OZON_API_KEY?.trim()),
    avito:Boolean(process.env.AVITO_CLIENT_ID?.trim()&&process.env.AVITO_CLIENT_SECRET?.trim()),
  };
}

export async function testWildberries(){
  const token=env('WB_API_TOKEN');
  const res=await fetch('https://marketplace-api.wildberries.ru/ping',{
    headers:{Authorization:token},cache:'no-store'
  });
  const data=await readJson(res);
  return {ok:true,details:data?.Status||data?.status||'OK'};
}

function isoDaysAgo(days:number){
  return new Date(Date.now()-days*86400000).toISOString();
}

export async function testOzon(){
  const clientId=env('OZON_CLIENT_ID');
  const apiKey=env('OZON_API_KEY');
  const now=new Date().toISOString();
  const res=await fetch('https://api-seller.ozon.ru/v4/posting/fbs/list',{
    method:'POST',
    headers:{'Client-Id':clientId,'Api-Key':apiKey,'Content-Type':'application/json'},
    body:JSON.stringify({
      sort_dir:'desc',
      filter:{since:isoDaysAgo(1),to:now,status:[]},
      limit:1,
      cursor:'',
      with:{analytics_data:false,barcodes:false,financial_data:false,legal_info:false,translit:false}
    }),
    cache:'no-store'
  });
  await readJson(res);
  return {ok:true,details:'OK'};
}

async function upsertMarketplaceOrder(input:{
  source:MarketplaceName; externalId:string; orderNumber?:string|null; status:string; totalAmount:number;
  customerName?:string|null; phone?:string|null; items:any[]; raw:any; createdAt?:string|null;
}){
  await ensureSchema();
  const pool=getPool();
  await pool.query(`
    INSERT INTO marketplace_orders
      (source,external_id,order_number,status,total_amount,customer_name,phone,items,raw_payload,external_created_at,synced_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,NOW(),NOW())
    ON CONFLICT (source,external_id) DO UPDATE SET
      order_number=EXCLUDED.order_number,
      status=EXCLUDED.status,
      total_amount=EXCLUDED.total_amount,
      customer_name=EXCLUDED.customer_name,
      phone=EXCLUDED.phone,
      items=EXCLUDED.items,
      raw_payload=EXCLUDED.raw_payload,
      external_created_at=COALESCE(EXCLUDED.external_created_at,marketplace_orders.external_created_at),
      synced_at=NOW(),updated_at=NOW()
  `,[input.source,input.externalId,input.orderNumber||null,input.status,input.totalAmount,input.customerName||null,input.phone||null,JSON.stringify(input.items),JSON.stringify(input.raw),input.createdAt||null]);
}

function moneyToRubles(value:any){
  if(value==null) return 0;
  if(typeof value==='number') return Math.round(value);
  if(typeof value==='string') return Math.round(Number(value)||0);
  if(typeof value==='object'){
    const candidate=value.value??value.price??value.amount;
    return Math.round(Number(candidate)||0);
  }
  return 0;
}

export async function syncWildberriesOrders(){
  const token=env('WB_API_TOKEN');
  const res=await fetch('https://marketplace-api.wildberries.ru/api/v3/orders/new',{
    headers:{Authorization:token},cache:'no-store'
  });
  const data=await readJson(res);
  const orders=Array.isArray(data?.orders)?data.orders:[];
  for(const o of orders){
    const items=[{
      nmId:o.nmId??null,
      chrtId:o.chrtId??null,
      article:o.article??null,
      skus:Array.isArray(o.skus)?o.skus:[],
      quantity:1,
      price:Number(o.finalPrice??o.convertedFinalPrice??o.price??0)||0,
    }];
    await upsertMarketplaceOrder({
      source:'wildberries',
      externalId:String(o.id),
      orderNumber:String(o.id),
      status:'new',
      totalAmount:Math.round(Number(o.finalPrice??o.convertedFinalPrice??o.price??0)||0),
      items,
      raw:o,
      createdAt:o.createdAt||null,
    });
  }
  return {synced:orders.length};
}

export async function syncOzonOrders(days=30){
  const clientId=env('OZON_CLIENT_ID');
  const apiKey=env('OZON_API_KEY');
  let cursor='';
  let total=0;
  for(let page=0;page<10;page++){
    const res=await fetch('https://api-seller.ozon.ru/v4/posting/fbs/list',{
      method:'POST',
      headers:{'Client-Id':clientId,'Api-Key':apiKey,'Content-Type':'application/json'},
      body:JSON.stringify({
        sort_dir:'desc',
        filter:{since:isoDaysAgo(days),to:new Date().toISOString(),status:[]},
        limit:100,
        cursor,
        with:{analytics_data:false,barcodes:false,financial_data:false,legal_info:false,translit:false}
      }),
      cache:'no-store'
    });
    const data=await readJson(res);
    const postings=Array.isArray(data?.postings)?data.postings:(Array.isArray(data?.result?.postings)?data.result.postings:[]);
    for(const p of postings){
      const products=Array.isArray(p.products)?p.products:[];
      const items=products.map((x:any)=>({
        sku:x.sku??null,
        offerId:x.offer_id??null,
        name:x.name??'',
        quantity:Number(x.quantity)||1,
        price:moneyToRubles(x.price),
      }));
      const totalAmount=items.reduce((s:number,x:any)=>s+(Number(x.price)||0)*(Number(x.quantity)||1),0);
      await upsertMarketplaceOrder({
        source:'ozon',
        externalId:String(p.posting_number??p.order_number??p.order_id),
        orderNumber:String(p.order_number??p.posting_number??''),
        status:String(p.status??p.substatus??'unknown'),
        totalAmount,
        customerName:p.addressee?.name??p.customer?.name??null,
        phone:p.addressee?.phone??p.customer?.phone??null,
        items,
        raw:p,
        createdAt:p.in_process_at??p.shipment_date??null,
      });
    }
    total+=postings.length;
    const hasNext=Boolean(data?.has_next??data?.result?.has_next);
    const nextCursor=String(data?.cursor??data?.result?.cursor??'');
    if(!hasNext||!nextCursor||nextCursor===cursor) break;
    cursor=nextCursor;
  }
  return {synced:total};
}

export async function testMarketplace(name:MarketplaceName){
  return name==='wildberries'?testWildberries():testOzon();
}

export async function syncMarketplace(name:MarketplaceName){
  return name==='wildberries'?syncWildberriesOrders():syncOzonOrders();
}
