import fs from 'node:fs';
import pg from 'pg';
function loadEnv(path){const out={};for(const line of fs.readFileSync(path,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(!m)continue;let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);out[m[1]]=v}return out}
const env={...loadEnv('/var/www/duisun/.env.production'),...process.env};
if(!env.DATABASE_URL)throw new Error('DATABASE_URL missing');
const remote=await fetch('https://techroom-main.onrender.com/api/products',{cache:'no-store',signal:AbortSignal.timeout(60000)});
if(!remote.ok)throw new Error(`Render catalog HTTP ${remote.status}`);
const items=await remote.json();
if(!Array.isArray(items))throw new Error('Render catalog invalid');
const real=items.filter(p=>p&&p.sku&&p.title&&Number(p.price)>=0).map(p=>{const urls=[p.imageUrl,...(Array.isArray(p.imageUrls)?p.imageUrls:[])].filter(Boolean).join(' ');const source=/wbbasket\.ru/i.test(urls)?'wb':/ozone\.ru|ozon\.ru/i.test(urls)?'ozon':null;return{...p,marketplace_source:source}}).filter(p=>p.marketplace_source);
if(!real.length)throw new Error('No verified WB/Ozon products in mirror');
const pool=new pg.Pool({connectionString:env.DATABASE_URL,ssl:env.DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false},max:2});
await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS marketplace_source TEXT");
await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS marketplace_product_id TEXT");
await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS marketplace_payload JSONB NOT NULL DEFAULT '{}'::jsonb");
const seen=[];
for(const p of real){const sku=String(p.sku).trim();seen.push(sku);const imageUrls=Array.isArray(p.imageUrls)?p.imageUrls.filter(x=>typeof x==='string'):[];const existing=await pool.query('SELECT id FROM products WHERE sku=$1 ORDER BY id LIMIT 1',[sku]);const vals=[p.category||'Гаджеты',String(p.title),Math.max(0,Math.round(Number(p.price)||0)),p.oldPrice==null?null:Math.max(0,Math.round(Number(p.oldPrice)||0)),Number(p.rating)||5,Math.max(0,Math.round(Number(p.reviews)||0)),p.badge||'Маркетплейс',p.emoji||'📦',p.imageUrl||imageUrls[0]||null,JSON.stringify(imageUrls),sku,p.oem||null,Math.max(0,Math.round(Number(p.stock)||0)),p.description||'',p.specs||'',true,Number(p.sortOrder)||1000,p.marketplace_source,String(p.id||''),JSON.stringify({mirror:'render',syncedAt:new Date().toISOString()})];if(existing.rows[0])await pool.query(`UPDATE products SET category=$1,title=$2,price=$3,old_price=$4,rating=$5,reviews=$6,badge=$7,emoji=$8,image_url=$9,image_urls=$10::jsonb,sku=$11,oem=$12,stock=$13,description=$14,specs=$15,is_active=$16,sort_order=$17,marketplace_source=$18,marketplace_product_id=$19,marketplace_payload=$20::jsonb,updated_at=NOW() WHERE id=$21`,[...vals,existing.rows[0].id]);else await pool.query(`INSERT INTO products(category,title,price,old_price,rating,reviews,badge,emoji,image_url,image_urls,sku,oem,stock,description,specs,is_active,sort_order,marketplace_source,marketplace_product_id,marketplace_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)`,vals)}
await pool.query("UPDATE products SET is_active=FALSE,updated_at=NOW() WHERE marketplace_source IN ('wb','ozon') AND NOT (sku = ANY($1::text[]))",[seen]);
await pool.end();
console.log(JSON.stringify({ok:true,received:items.length,imported:real.length,wb:real.filter(x=>x.marketplace_source==='wb').length,ozon:real.filter(x=>x.marketplace_source==='ozon').length}));
