import fs from 'node:fs';
import pg from 'pg';

const request=String(process.env.WEB_OP_REQUEST||'status').trim().slice(0,500);
const wantsAction=/\b(sync|repair|publish)\b/i.test(request);
const sku=(request.match(/\bsku[:= ]([A-Za-z0-9._-]+)/i)?.[1]||request.match(/\b(dskgothtoy1)\b/i)?.[1]||'dskgothtoy1').trim();
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}});

const out={checkedAt:new Date().toISOString(),request,sku,health:null,renderReferences:null,product:null,warehouses:{wb:false,ozon:false},marketplace:{ozon:null,wildberries:null},actions:[],sync:null};

async function fetchJson(url,init={}){
  const r=await fetch(url,{...init,cache:'no-store'});
  const t=await r.text();
  let j={}; try{j=t?JSON.parse(t):{}}catch{j={raw:t.slice(0,1000)}}
  return {r,j};
}
function wbHeaders(){return {Authorization:process.env.WB_API_TOKEN||'','Content-Type':'application/json'}}
function ozHeaders(){return {'Client-Id':process.env.OZON_CLIENT_ID||'','Api-Key':process.env.OZON_API_KEY||'','Content-Type':'application/json'}}

async function getProduct(){
  const q=await pool.query('SELECT id,sku,title,price,stock,image_url,image_urls,is_active,updated_at FROM products WHERE sku=$1 LIMIT 1',[sku]);
  return q.rows[0]||null;
}
async function discoverWarehouses(){
  await pool.query("CREATE TABLE IF NOT EXISTS marketplace_settings (key TEXT PRIMARY KEY,value TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  if(process.env.WB_API_TOKEN){
    const {r,j}=await fetchJson('https://marketplace-api.wildberries.ru/api/v3/warehouses',{headers:{Authorization:process.env.WB_API_TOKEN}});
    if(r.ok&&Array.isArray(j)&&j.length){
      const w=j.find(x=>String(x?.deliveryType||'').toLowerCase().includes('fbs'))||j[0];
      if(w?.id!=null){
        await pool.query("INSERT INTO marketplace_settings(key,value) VALUES('wb_warehouse_id',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()",[String(w.id)]);
        out.warehouses.wb=true;
      }
    }
  }
  if(process.env.OZON_CLIENT_ID&&process.env.OZON_API_KEY){
    const {r,j}=await fetchJson('https://api-seller.ozon.ru/v2/warehouse/list',{method:'POST',headers:ozHeaders(),body:JSON.stringify({limit:100})});
    const rows=Array.isArray(j?.warehouses)?j.warehouses:(Array.isArray(j?.result)?j.result:[]);
    if(r.ok&&rows.length){
      const w=rows.find(x=>String(x?.status||'').toLowerCase().includes('active')&&!x?.is_rfbs)||rows.find(x=>!x?.is_rfbs)||rows[0];
      if(w?.warehouse_id!=null){
        await pool.query("INSERT INTO marketplace_settings(key,value) VALUES('ozon_warehouse_id',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()",[String(w.warehouse_id)]);
        out.warehouses.ozon=true;
      }
    }
  }
  const q=await pool.query("SELECT key,value FROM marketplace_settings WHERE key IN ('wb_warehouse_id','ozon_warehouse_id')");
  const map=new Map(q.rows.map(x=>[x.key,String(x.value||'')]));
  return {wb:map.get('wb_warehouse_id')||'',ozon:map.get('ozon_warehouse_id')||''};
}
async function wbCard(){
  const {r,j}=await fetchJson('https://content-api.wildberries.ru/content/v2/get/cards/list',{method:'POST',headers:wbHeaders(),body:JSON.stringify({settings:{cursor:{limit:100},filter:{textSearch:sku,withPhoto:-1},sort:{ascending:false}}})});
  const x=(j.cards||[]).find(v=>String(v.vendorCode||'')===sku)||null;
  return {r,j,x};
}
async function ozItem(){
  const {r,j}=await fetchJson('https://api-seller.ozon.ru/v3/product/info/list',{method:'POST',headers:ozHeaders(),body:JSON.stringify({offer_id:[sku],product_id:[],sku:[]})});
  const x=(j.items||j.result?.items||[])[0]||null;
  return {r,j,x};
}

try{
  if(wantsAction){
    const migrated=await pool.query(`
      UPDATE products SET
        image_url=CASE WHEN image_url LIKE 'https://techroom-main.onrender.com/%'
          THEN replace(image_url,'https://techroom-main.onrender.com','https://duisun.ru') ELSE image_url END,
        image_urls=(SELECT COALESCE(jsonb_agg(to_jsonb(replace(value,'https://techroom-main.onrender.com','https://duisun.ru'))),'[]'::jsonb) FROM jsonb_array_elements_text(image_urls)),
        updated_at=NOW()
      WHERE image_url LIKE 'https://techroom-main.onrender.com/%' OR image_urls::text LIKE '%techroom-main.onrender.com%'
    `);
    out.actions.push({action:'migrate_render_urls',rows:migrated.rowCount});

    await pool.query(`
      INSERT INTO price_sheet(sku,product_id,title,price,min_price,sync_ozon,sync_wb,updated_at)
      SELECT sku,id,title,price,0,TRUE,TRUE,NOW() FROM products WHERE sku=$1
      ON CONFLICT(sku) DO UPDATE SET product_id=EXCLUDED.product_id,title=EXCLUDED.title,price=EXCLUDED.price,sync_ozon=TRUE,sync_wb=TRUE,updated_at=NOW()
    `,[sku]).catch(()=>{});

    const wh=await discoverWarehouses();
    const p=await getProduct();
    if(p){
      const image=String(p.image_url||'').replace('https://techroom-main.onrender.com','https://duisun.ru');

      if(process.env.OZON_CLIENT_ID&&process.env.OZON_API_KEY){
        const pricePayload={prices:[{offer_id:sku,price:String(p.price),old_price:'0',premium_price:'0',auto_action_enabled:'DISABLED'}]};
        const pr=await fetchJson('https://api-seller.ozon.ru/v1/product/import/prices',{method:'POST',headers:ozHeaders(),body:JSON.stringify(pricePayload)});
        out.actions.push({action:'ozon_price',ok:pr.r.ok,status:pr.r.status});
        if(wh.ozon){
          const sr=await fetchJson('https://api-seller.ozon.ru/v2/products/stocks',{method:'POST',headers:ozHeaders(),body:JSON.stringify({stocks:[{offer_id:sku,stock:Math.max(0,Number(p.stock)||0),warehouse_id:Number(wh.ozon)}]})});
          out.actions.push({action:'ozon_stock',ok:sr.r.ok,status:sr.r.status});
        }
      }

      if(process.env.WB_API_TOKEN){
        const card=await wbCard();
        const nmID=Number(card.x?.nmID||0);
        const barcode=card.x?.sizes?.flatMap(s=>Array.isArray(s.skus)?s.skus:[])[0];
        if(nmID){
          const pr=await fetchJson('https://discounts-prices-api.wildberries.ru/api/v2/upload/task',{method:'POST',headers:wbHeaders(),body:JSON.stringify({data:[{nmID,price:Number(p.price)}]})});
          out.actions.push({action:'wb_price',ok:pr.r.ok||pr.r.status===208,status:pr.r.status});
          if(image){
            const ir=await fetchJson('https://content-api.wildberries.ru/content/v3/media/save',{method:'POST',headers:wbHeaders(),body:JSON.stringify({nmId:nmID,data:[image]})});
            out.actions.push({action:'wb_image',ok:ir.r.ok,status:ir.r.status});
          }
        }
        if(wh.wb&&barcode){
          const sr=await fetchJson('https://marketplace-api.wildberries.ru/api/v3/stocks/'+encodeURIComponent(wh.wb),{method:'PUT',headers:wbHeaders(),body:JSON.stringify({stocks:[{sku:String(barcode),amount:Math.max(0,Number(p.stock)||0)}]})});
          out.actions.push({action:'wb_stock',ok:sr.r.ok,status:sr.r.status});
        }
      }

      try{
        const cfg=await pool.query("SELECT value FROM marketplace_settings WHERE key='ozon_warehouse_id'");
        if(cfg.rows[0]?.value)process.env.OZON_WAREHOUSE_ID=String(cfg.rows[0].value);
      }catch{}
    }

    try{
      const secret=process.env.CRON_SYNC_SECRET||'';
      const r=await fetch('http://127.0.0.1:3000/api/internal/marketplace-sync?force=1&transfers=1',{method:'POST',headers:{'x-cron-secret':secret}});
      out.sync={httpStatus:r.status,...(await r.json().catch(()=>({})))};
    }catch(e){out.sync={error:String(e?.message||e)}}
  }else{
    await discoverWarehouses();
  }

  try{const r=await fetch('http://127.0.0.1:3000/api/health');out.health=await r.json()}catch(e){out.health={ok:false,error:String(e?.message||e)}}
  out.product=await getProduct();
  out.renderReferences=Number((await pool.query("SELECT count(*)::int AS n FROM products WHERE image_url LIKE '%onrender.com%' OR image_urls::text LIKE '%onrender.com%'")).rows[0]?.n||0);

  if(process.env.OZON_CLIENT_ID&&process.env.OZON_API_KEY){
    const {r,x}=await ozItem();
    out.marketplace.ozon={ok:r.ok,status:r.status,item:x?{id:x.id||x.product_id||null,offer_id:x.offer_id||null,name:x.name||null,price:x.price||null,images:Array.isArray(x.images)?x.images.length:null,stocks:x.stocks||null,visible:x.visible??null,status:x.status||null}:null};
  }
  if(process.env.WB_API_TOKEN){
    const {r,x}=await wbCard();
    const wh=(await pool.query("SELECT value FROM marketplace_settings WHERE key='wb_warehouse_id'")).rows[0]?.value||'';
    const barcode=x?.sizes?.flatMap(s=>Array.isArray(s.skus)?s.skus:[])[0];
    let stock=null;
    if(wh&&barcode){
      const sr=await fetchJson('https://marketplace-api.wildberries.ru/api/v3/stocks/'+encodeURIComponent(wh),{method:'POST',headers:wbHeaders(),body:JSON.stringify({skus:[String(barcode)]})});
      stock={ok:sr.r.ok,status:sr.r.status,data:sr.j};
    }
    out.marketplace.wildberries={ok:r.ok,status:r.status,item:x?{nmID:x.nmID||null,vendorCode:x.vendorCode||null,title:x.title||null,photos:Array.isArray(x.photos)?x.photos.length:null,dimensions:x.dimensions||null,sizes:x.sizes||null}:null,stock};
  }

  try{
    const ir=await fetch('https://duisun.ru/products/dskgothtoy1-main.jpg',{method:'HEAD'});
    out.publicImage={ok:ir.ok,status:ir.status,contentType:ir.headers.get('content-type')};
  }catch(e){out.publicImage={ok:false,error:String(e?.message||e)}}
}finally{
  await pool.end();
}
process.stdout.write(JSON.stringify(out,null,2));
