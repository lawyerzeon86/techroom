import { ensureSchema, getPool } from './db';

async function discoverWbWarehouseId(){
  const token=process.env.WB_API_TOKEN?.trim();
  if(!token)return null;
  try{
    const res=await fetch('https://marketplace-api.wildberries.ru/api/v3/warehouses',{headers:{Authorization:token},cache:'no-store'});
    const data=await res.json().catch(()=>[]);
    if(!res.ok||!Array.isArray(data)||!data.length)return null;
    const preferred=data.find((w:any)=>String(w?.deliveryType||'').toLowerCase().includes('fbs'))||data[0];
    return preferred?.id!=null?String(preferred.id):null;
  }catch{return null}
}

async function discoverOzonWarehouseId(){
  const clientId=process.env.OZON_CLIENT_ID?.trim(),apiKey=process.env.OZON_API_KEY?.trim();
  if(!clientId||!apiKey)return null;
  try{
    const res=await fetch('https://api-seller.ozon.ru/v1/warehouse/list',{
      method:'POST',
      headers:{'Client-Id':clientId,'Api-Key':apiKey,'Content-Type':'application/json'},
      body:'{}',
      cache:'no-store'
    });
    const data=await res.json().catch(()=>({}));
    const rows=Array.isArray(data?.result)?data.result:[];
    if(!res.ok||!rows.length)return null;
    const preferred=rows.find((w:any)=>String(w?.status||'').toLowerCase().includes('active')&&!w?.is_rfbs)
      ||rows.find((w:any)=>!w?.is_rfbs)
      ||rows[0];
    return preferred?.warehouse_id!=null?String(preferred.warehouse_id):null;
  }catch{return null}
}

export async function getWarehouseSettings(){
  await ensureSchema();
  const pool=getPool();
  await pool.query("CREATE TABLE IF NOT EXISTS marketplace_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  const result=await pool.query("SELECT key,value FROM marketplace_settings WHERE key = ANY($1::text[])",[['wb_warehouse_id','ozon_warehouse_id']]);
  const values=new Map(result.rows.map((row:any)=>[String(row.key),String(row.value||'')]));
  let wbWarehouseId=values.get('wb_warehouse_id')||process.env.WB_WAREHOUSE_ID?.trim()||null;
  let ozonWarehouseId=values.get('ozon_warehouse_id')||process.env.OZON_WAREHOUSE_ID?.trim()||null;

  if(!wbWarehouseId){
    wbWarehouseId=await discoverWbWarehouseId();
    if(wbWarehouseId)await pool.query("INSERT INTO marketplace_settings(key,value,updated_at) VALUES('wb_warehouse_id',$1,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()",[wbWarehouseId]);
  }
  if(!ozonWarehouseId){
    ozonWarehouseId=await discoverOzonWarehouseId();
    if(ozonWarehouseId)await pool.query("INSERT INTO marketplace_settings(key,value,updated_at) VALUES('ozon_warehouse_id',$1,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()",[ozonWarehouseId]);
  }

  return {wbWarehouseId,ozonWarehouseId};
}

export async function saveWarehouseSettings(input:{wbWarehouseId?:string|null;ozonWarehouseId?:string|null}){
  await ensureSchema();
  const pool=getPool();
  await pool.query("CREATE TABLE IF NOT EXISTS marketplace_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  for(const [key,value] of [['wb_warehouse_id',input.wbWarehouseId],['ozon_warehouse_id',input.ozonWarehouseId]] as const){
    if(value===undefined) continue;
    await pool.query("INSERT INTO marketplace_settings(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()",[key,value?.trim()||null]);
  }
  return getWarehouseSettings();
}
