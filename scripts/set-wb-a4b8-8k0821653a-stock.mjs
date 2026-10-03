import pg from 'pg';

const {Pool}=pg;
const token=process.env.WB_API_TOKEN?.trim();

async function main(){
  if(!token) throw new Error('WB_API_TOKEN_NOT_CONFIGURED');
  let warehouseId=process.env.WB_WAREHOUSE_ID?.trim()||'';
  if(!warehouseId){
    const wr=await fetch('https://marketplace-api.wildberries.ru/api/v3/warehouses',{headers:{Authorization:token}});
    const ws=await wr.json().catch(()=>[]);
    if(!wr.ok||!Array.isArray(ws)||!ws.length) throw new Error(`WB_WAREHOUSES_${wr.status}`);
    const preferred=ws.find(w=>String(w?.deliveryType||'').toLowerCase().includes('fbs'))||ws[0];
    warehouseId=String(preferred?.id||'');
  }
  if(!warehouseId) throw new Error('WB_WAREHOUSE_ID_NOT_FOUND');

  const matches=[];
  let cursor={limit:100};
  for(let page=0;page<20;page++){
    const r=await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list',{
      method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},
      body:JSON.stringify({settings:{cursor,filter:{withPhoto:-1},sort:{ascending:false}}})
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(String(j?.message||`WB_CARDS_${r.status}`));
    const cards=Array.isArray(j?.cards)?j.cards:[];
    for(const c of cards){
      const hay=`${c?.title||''} ${c?.vendorCode||''}`.toLowerCase();
      if(hay.includes('8k0821653a')) matches.push(c);
    }
    if(matches.length||cards.length<100) break;
    if(!j?.cursor?.updatedAt||!j?.cursor?.nmID) break;
    cursor={limit:100,updatedAt:j.cursor.updatedAt,nmID:j.cursor.nmID};
  }
  if(!matches.length) throw new Error('TARGET_NOT_FOUND_8K0821653A');

  const stocks=[];
  for(const c of matches){
    for(const size of Array.isArray(c?.sizes)?c.sizes:[]){
      for(const barcode of Array.isArray(size?.skus)?size.skus:[]) if(barcode) stocks.push({sku:String(barcode),amount:10});
    }
  }
  if(!stocks.length) throw new Error('TARGET_HAS_NO_BARCODES');

  const up=await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(warehouseId)}`,{
    method:'PUT',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({stocks})
  });
  const text=await up.text();
  if(!up.ok) throw new Error(`WB_STOCK_${up.status}${text?': '+text.slice(0,500):''}`);

  let local=[];
  if(process.env.DATABASE_URL){
    const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false},max:1});
    try{
      const q=await pool.query("UPDATE products SET stock=10,updated_at=NOW() WHERE lower(COALESCE(title,'')) LIKE '%8k0821653a%' OR lower(COALESCE(sku,'')) LIKE '%8k0821653a%' RETURNING id,sku,title,stock");
      local=q.rows;
    }finally{await pool.end()}
  }

  console.log('[one-time-wb-stock] completed',JSON.stringify({warehouseId,stock:10,cards:matches.map(c=>({nmID:c.nmID,vendorCode:c.vendorCode,title:c.title})),barcodes:stocks.map(s=>s.sku),local}));
}

main().catch(e=>{console.error('[one-time-wb-stock]',String(e?.message||e));process.exitCode=0;});
