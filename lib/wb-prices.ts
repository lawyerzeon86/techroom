import { createHash } from 'node:crypto';
import { getPool } from './db';

// Shared across catalogue imports and price protection, and survives PM2 restarts.
export async function loadWbPriceGoods(token:string, allowStale=false):Promise<any[]>{
  const pool=getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS wb_price_cache (key TEXT PRIMARY KEY,goods JSONB NOT NULL DEFAULT '[]'::jsonb,fetched_at TIMESTAMPTZ,next_request_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const key=createHash('sha256').update(token).digest('hex');
  const client=await pool.connect();
  let committed=false;
  try{
    await client.query('BEGIN');
    await client.query(`INSERT INTO wb_price_cache(key) VALUES($1) ON CONFLICT DO NOTHING`,[key]);
    const {rows}=await client.query('SELECT * FROM wb_price_cache WHERE key=$1 FOR UPDATE',[key]);
    const row=rows[0], now=Date.now();
    if(row.fetched_at&&now-new Date(row.fetched_at).getTime()<16*60*1000){await client.query('COMMIT');committed=true;return row.goods}
    if(new Date(row.next_request_at).getTime()>now){
      await client.query('COMMIT');committed=true;
      if(allowStale&&row.fetched_at)return row.goods;
      throw Object.assign(new Error('WB_RATE_LIMITED'),{status:429,retryAt:new Date(row.next_request_at).getTime()});
    }
    const response=await fetch('https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1000&offset=0',{headers:{Authorization:token},cache:'no-store',signal:AbortSignal.timeout(20000)});
    const numeric=Number(response.headers.get('x-ratelimit-retry')||response.headers.get('retry-after'));
    const next=now+Math.max(16*60*1000,Number.isFinite(numeric)?numeric*1000:0);
    if(!response.ok){
      await client.query('UPDATE wb_price_cache SET next_request_at=$2 WHERE key=$1',[key,new Date(next)]);
      await client.query('COMMIT');committed=true;
      if(allowStale&&row.fetched_at)return row.goods;
      throw Object.assign(new Error(`WB_HTTP_${response.status}`),{status:response.status,retryAt:next});
    }
    const data=await response.json();
    const goods=data?.data?.listGoods||data?.listGoods||[];
    if(!Array.isArray(goods))throw new Error('WB_PRICES_INVALID');
    // Fail rather than silently use a truncated catalogue for price protection.
    if(goods.length>=1000)throw new Error('WB_PRICES_PAGINATION_REQUIRED');
    await client.query('UPDATE wb_price_cache SET goods=$2::jsonb,fetched_at=NOW(),next_request_at=$3 WHERE key=$1',[key,JSON.stringify(goods),new Date(next)]);
    await client.query('COMMIT');committed=true;
    return goods;
  }finally{if(!committed)await client.query('ROLLBACK').catch(()=>{});client.release()}
}
