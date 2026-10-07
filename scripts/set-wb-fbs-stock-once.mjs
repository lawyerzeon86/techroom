const token=(process.env.WB_API_TOKEN||'').trim();
const warehouseId=(process.env.WB_WAREHOUSE_ID||'604848').trim();
const targets=new Set(['1344233224','1344806387','1363287832']);

if(!token)throw new Error('WB_API_TOKEN is not configured');

const found=new Map();
let cursor={limit:100};
for(let page=0;page<50 && found.size<targets.size;page++){
  const body={settings:{cursor,filter:{withPhoto:-1},sort:{ascending:false}}};
  const res=await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list',{
    method:'POST',
    headers:{Authorization:token,'Content-Type':'application/json'},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(20000)
  });
  const json=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(`WB cards ${res.status}: ${JSON.stringify(json).slice(0,500)}`);
  const cards=Array.isArray(json?.cards)?json.cards:[];
  for(const card of cards){
    const nm=String(card?.nmID??'');
    const vendor=String(card?.vendorCode??'').trim();
    const key=targets.has(nm)?nm:(targets.has(vendor)?vendor:null);
    if(!key)continue;
    const skus=[];
    for(const size of Array.isArray(card?.sizes)?card.sizes:[]){
      for(const sku of Array.isArray(size?.skus)?size.skus:[]){
        if(sku)skus.push(String(sku));
      }
    }
    found.set(key,{nmID:nm,vendorCode:vendor,skus:[...new Set(skus)]});
  }
  const c=json?.cursor||{};
  if(!cards.length || !c?.updatedAt || !c?.nmID)break;
  cursor={limit:100,updatedAt:c.updatedAt,nmID:c.nmID};
}

const missing=[...targets].filter(x=>!found.has(x));
if(missing.length)throw new Error('WB target articles not found: '+missing.join(', '));

const stocks=[];
for(const [requested,card] of found){
  if(!card.skus.length)throw new Error('No WB barcodes for '+requested);
  for(const sku of card.skus)stocks.push({sku,amount:10});
}

const put=await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(warehouseId)}`,{
  method:'PUT',
  headers:{Authorization:token,'Content-Type':'application/json'},
  body:JSON.stringify({stocks}),
  signal:AbortSignal.timeout(20000)
});
const responseText=await put.text().catch(()=>'');
if(!put.ok)throw new Error(`WB stock update ${put.status}: ${responseText.slice(0,500)}`);

console.log(JSON.stringify({ok:true,warehouseId,amount:10,updated:[...found.entries()].map(([requested,v])=>({requested,nmID:v.nmID,vendorCode:v.vendorCode,skus:v.skus}))},null,2));
