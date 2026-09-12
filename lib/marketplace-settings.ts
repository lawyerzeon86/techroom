import { ensureSchema, getPool } from './db';

export async function getWarehouseSettings(){
  await ensureSchema();
  const pool=getPool();
  await pool.query("CREATE TABLE IF NOT EXISTS marketplace_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  const result=await pool.query("SELECT key,value FROM marketplace_settings WHERE key = ANY($1::text[])",[['wb_warehouse_id','ozon_warehouse_id']]);
  const values=new Map(result.rows.map((row:any)=>[String(row.key),String(row.value||'')]));
  return {
    wbWarehouseId:values.get('wb_warehouse_id')||process.env.WB_WAREHOUSE_ID?.trim()||null,
    ozonWarehouseId:values.get('ozon_warehouse_id')||process.env.OZON_WAREHOUSE_ID?.trim()||null
  };
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
