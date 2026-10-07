import pg from 'pg';

const token=(process.env.WB_API_TOKEN||'').trim();
const warehouseId=(process.env.WB_WAREHOUSE_ID||'604848').trim();
if(!token)throw new Error('WB_API_TOKEN is not configured');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is not configured');

const pool=new pg.Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false},
  max:1
});

const cache=await pool.query('SELECT cards FROM wb_catalog_cache ORDER BY fetched_at DESC NULLS LAST LIMIT 1').catch(()=>({rows:[]}));
await pool.end();
const cards=Array.isArray(cache.rows?.[0]?.cards)?cache.rows[0].cards:[];
if(!cards.length)throw new Error('WB catalog cache is empty');

const byChrt=new Map();
for(const card of cards){
  for(const size of Array.isArray(card?.sizes)?card.sizes:[]){
    const chrtId=Number(size?.chrtID||size?.chrtId||0);
    if(!Number.isFinite(chrtId)||chrtId<=0)continue;
    byChrt.set(chrtId,{
      nmID:String(card?.nmID||''),
      vendorCode:String(card?.vendorCode||''),
      title:String(card?.title||''),
      techSize:String(size?.techSize||size?.wbSize||'')
    });
  }
}
const chrtIds=[...byChrt.keys()];
if(!chrtIds.length)throw new Error('No WB chrtIds in cache');

const all=[];
for(let i=0;i<chrtIds.length;i+=1000){
  const batch=chrtIds.slice(i,i+1000);
  const r=await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(warehouseId)}`,{
    method:'POST',
    headers:{Authorization:token,'Content-Type':'application/json'},
    body:JSON.stringify({chrtIds:batch}),
    signal:AbortSignal.timeout(20000)
  });
  const text=await r.text();
  let json={}; try{json=text?JSON.parse(text):{}}catch{}
  if(!r.ok)throw new Error(`WB stock read ${r.status}: ${text.slice(0,500)}`);
  for(const s of Array.isArray(json?.stocks)?json.stocks:[])all.push(s);
}
const grouped=new Map();
for(const s of all){
  const chrtId=Number(s?.chrtId||s?.chrtID||0);
  const meta=byChrt.get(chrtId); if(!meta)continue;
  const key=meta.nmID||meta.vendorCode||String(chrtId);
  const cur=grouped.get(key)||{nmID:meta.nmID,vendorCode:meta.vendorCode,title:meta.title,amount:0,sizes:[]};
  cur.amount+=Number(s?.amount||0);
  cur.sizes.push({chrtId,techSize:meta.techSize,amount:Number(s?.amount||0)});
  grouped.set(key,cur);
}
const rows=[...grouped.values()].sort((a,b)=>Number(a.nmID||0)-Number(b.nmID||0));
console.log(JSON.stringify({ok:true,warehouseId,count:rows.length,rows},null,2));
