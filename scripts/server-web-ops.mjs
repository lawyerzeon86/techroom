import pg from 'pg';

const sku=String(process.argv[3]||process.argv[2]||'dskgothtoy1').trim();
const command=process.argv[2]||'check';
const base=(process.env.PUBLIC_STORE_URL||'http://127.0.0.1:3000').replace(/\/$/,'');
const wbToken=(process.env.WB_API_TOKEN||'').trim();
const ozonHeaders={'Client-Id':String(process.env.OZON_CLIENT_ID||''),'Api-Key':String(process.env.OZON_API_KEY||''),'Content-Type':'application/json'};

async function request(url,init={}){
  const response=await fetch(url,{...init,signal:AbortSignal.timeout(45000)});
  const text=await response.text();
  let data={}; try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!response.ok)throw new Error(`HTTP_${response.status}: ${text.slice(0,600)}`);
  return data;
}
async function post(url,body,headers){return request(url,{method:'POST',headers,body:JSON.stringify(body)})}
function firstArray(...values){return values.find(Array.isArray)||[]}
function productFrom(payload){
  const rows=Array.isArray(payload)?payload:firstArray(payload?.products,payload?.items,payload?.data);
  return rows.find(p=>String(p?.sku||p?.article||'')===sku)||{};
}
async function siteCheck(){
  let health={ok:false,database:'unknown'};
  try{health=await request(base+'/api/health')}catch{
    try{await request(base+'/api/products');health={ok:true,database:'up'}}catch{}
  }
  const payload=await request(base+'/api/products');
  const product=productFrom(payload);
  return {health,product:{
    id:product.id??null,sku:product.sku??null,
    price:Number(product.price??0),stock:Number(product.stock??product.quantity??0),
    image_url:product.image_url??product.imageUrl??null
  }};
}
async function wbCheck(){
  if(!wbToken)return {ok:false,error:'WB_API_TOKEN_NOT_CONFIGURED'};
  const headers={Authorization:wbToken,'Content-Type':'application/json'};
  const list=await post('https://content-api.wildberries.ru/content/v2/get/cards/list',
    {settings:{cursor:{limit:100},filter:{textSearch:sku,withPhoto:-1},sort:{ascending:false}}},headers);
  const card=(list.cards||[]).find(c=>String(c.vendorCode||'')===sku);
  if(!card)return {ok:false,error:'WB_CARD_NOT_FOUND'};
  const nmID=Number(card.nmID||0);
  let price=null;
  try{
    const d=await request(`https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1000&offset=0&filterNmID=${nmID}`,{headers:{Authorization:wbToken}});
    const g=firstArray(d?.data?.listGoods,d?.listGoods,d?.data)[0]||{};
    const sizes=firstArray(g.sizes,g?.data?.sizes);
    price={price:Number(g.discountedPrice??g.price??sizes[0]?.discountedPrice??sizes[0]?.price??0)};
  }catch(e){price={error:String(e.message)}}
  let stock={amount:null};
  try{
    const chrtIds=(card.sizes||[]).map(s=>Number(s.chrtID||s.chrtId)).filter(n=>n>0);
    const warehouse=String(process.env.WB_WAREHOUSE_ID||'604848');
    const d=await post(`https://marketplace-api.wildberries.ru/api/v3/stocks/${warehouse}`,{chrtIds},headers);
    stock={amount:(d.stocks||[]).reduce((sum,x)=>sum+Number(x.amount||0),0),warehouse};
  }catch(e){stock={amount:null,error:String(e.message)}}
  const photos=Array.isArray(card.photos)?card.photos.length:Number(Boolean(card.mediaFiles?.length));
  return {ok:true,nmID,photos,price,stock};
}
async function ozonCheck(){
  if(!ozonHeaders['Client-Id']||!ozonHeaders['Api-Key'])return {ok:false,error:'OZON_NOT_CONFIGURED'};
  const info=await post('https://api-seller.ozon.ru/v3/product/info/list',{offer_id:[sku],product_id:[],sku:[]},ozonHeaders);
  const item=firstArray(info.items,info?.result?.items)[0];
  if(!item)return {ok:false,error:'OZON_CARD_NOT_FOUND'};
  const id=Number(item.id||item.product_id||0);
  let prices={};
  try{
    const d=await post('https://api-seller.ozon.ru/v5/product/info/prices',{filter:{offer_id:[sku],product_id:[],visibility:'ALL'},cursor:'',limit:100},ozonHeaders);
    const x=firstArray(d.items,d?.result?.items)[0]||{};
    prices=x;
  }catch(e){prices={error:String(e.message)}}
  let stock={};
  try{
    const d=await post('https://api-seller.ozon.ru/v4/product/info/stocks',{filter:{offer_id:[sku],product_id:[],visibility:'ALL'},cursor:'',limit:100},ozonHeaders);
    const x=firstArray(d.items,d?.result?.items)[0]||{};
    stock=x;
  }catch(e){stock={error:String(e.message)}}
  const images=firstArray(item.images,item?.media?.images).length+Number(Boolean(item.primary_image));
  return {ok:true,id,images,price:prices,stock,statuses:item.statuses||null,visible:item.visible??null,errors:item.errors||[]};
}
async function syncAll(){
  const canonicalImage='https://duisun.ru/products/'+sku+'-main.jpg';
  const pool=new pg.Pool({
    connectionString:process.env.DATABASE_URL,
    ssl:String(process.env.DATABASE_URL||'').includes('localhost')?false:{rejectUnauthorized:false},
    max:1
  });
  try{
    await pool.query('UPDATE products SET image_url=$1,image_urls=$2::jsonb,price=299,stock=5,updated_at=NOW() WHERE sku=$3',
      [canonicalImage,JSON.stringify([canonicalImage]),sku]);
  }finally{await pool.end()}

  let wbPriceAction=null;
  if(wbToken){
    try{
      const wb=await wbCheck();
      await post('https://discounts-prices-api.wildberries.ru/api/v2/upload/task',
        {data:[{nmID:Number(wb.nmID),price:299,discount:0}]},
        {Authorization:wbToken,'Content-Type':'application/json'});
      wbPriceAction={status:'submitted',nmID:wb.nmID,price:299,discount:0};
    }catch(e){wbPriceAction={status:'error',error:String(e.message)}}
  }

  const secret=String(process.env.CRON_SYNC_SECRET||'');
  if(!secret)throw new Error('CRON_SYNC_SECRET_NOT_CONFIGURED');
  const result=await post(base+'/api/internal/publish-products',{sku},{'x-cron-secret':secret,'Content-Type':'application/json'});
  const row=(result.results||[]).find(x=>x.sku===sku)||{};
  const mp=row.result||{};
  return {
    ok:Boolean(result.ok||row.ok),sku,
    wildberries:{actions:{publish:mp.wb??null,price:wbPriceAction}},
    ozon:{actions:mp.ozon??null},raw:result
  };
}
async function check(){
  const [site,wildberries,ozon]=await Promise.all([
    siteCheck().catch(e=>({health:{ok:false},product:{},error:String(e.message)})),
    wbCheck().catch(e=>({ok:false,error:String(e.message)})),
    ozonCheck().catch(e=>({ok:false,error:String(e.message)}))
  ]);
  return {ok:Boolean(site?.health?.ok&&site?.product?.sku&&wildberries?.ok&&ozon?.ok),site,wildberries,ozon};
}
let output;
if(command==='sync-all')output=await syncAll();
else if(command==='check')output=await check();
else throw new Error('USAGE: server-web-ops.mjs <sync-all|check> [sku]');
process.stdout.write(JSON.stringify(output,null,2));
