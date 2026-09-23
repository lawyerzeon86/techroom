import { ensureSchema, getPool } from './db';

type SiteProduct = {
  id:number; sku:string; title:string; description:string; price:number; stock:number;
  imageUrl:string|null; specs:string|null;
};

function wbHeaders(){
  const token=process.env.WB_API_TOKEN?.trim();
  if(!token) throw new Error('WB_API_TOKEN_NOT_CONFIGURED');
  return {Authorization:token,'Content-Type':'application/json'};
}
function ozonHeaders(){
  const clientId=process.env.OZON_CLIENT_ID?.trim(), apiKey=process.env.OZON_API_KEY?.trim();
  if(!clientId||!apiKey) throw new Error('OZON_NOT_CONFIGURED');
  return {'Client-Id':clientId,'Api-Key':apiKey,'Content-Type':'application/json'};
}
async function json(url:string,init:RequestInit){
  const r=await fetch(url,{...init,cache:'no-store'});
  const t=await r.text(); let d:any={};
  try{d=t?JSON.parse(t):{}}catch{d={raw:t}}
  if(!r.ok) throw new Error(String(d?.message||d?.errorText||d?.error||d?.errors?.[0]?.message||`HTTP_${r.status}: ${t.slice(0,500)}`));
  return d;
}
function words(v:string){return String(v||'').toLowerCase().replace(/[^a-zа-я0-9]+/gi,' ').split(/\s+/).filter(x=>x.length>2)}
function score(a:string,b:string){
  const aa=new Set(words(a)), bb=words(b); if(!aa.size||!bb.length)return 0;
  let hit=0; for(const t of bb) if(aa.has(t)||[...aa].some(x=>x.includes(t)||t.includes(x)))hit++;
  return hit/Math.max(2,Math.min(aa.size,bb.length));
}
function absImage(url:string|null){
  if(!url)return null;
  if(/^https?:\/\//i.test(url))return url;
  const base=(process.env.RENDER_EXTERNAL_URL||'https://techroom-main.onrender.com').replace(/\/$/,'');
  return base+(url.startsWith('/')?'':'/')+url;
}
function parseSpecs(specs:string|null){
  const out:any={};
  for(const row of String(specs||'').split('\n')){
    const i=row.indexOf(':'); if(i<1)continue;
    out[row.slice(0,i).trim().toLowerCase()]=row.slice(i+1).trim();
  }
  return out;
}
function parsePackageSpec(specs:string|null){
  const s=parseSpecs(specs);
  const raw=String(s['размер упаковки']||'');
  const nums=(raw.match(/[\d.,]+/g)||[]).map((v:string)=>Number(v.replace(',','.'))).filter((n:number)=>Number.isFinite(n)&&n>0);
  const weightRaw=String(s['вес']||'');
  const wm=weightRaw.match(/[\d.,]+/);
  const weightG=wm?Number(wm[0].replace(',','.')):50;
  return {
    length:nums[0]||5,
    width:nums[1]||4,
    height:nums[2]||4,
    weightG:weightG>0?weightG:50
  };
}
async function loadProduct(sku:string):Promise<SiteProduct>{
  await ensureSchema(); const pool=getPool();
  const r=await pool.query(`SELECT id,sku,title,description,price,stock,image_url "imageUrl",specs FROM products WHERE sku=$1 LIMIT 1`,[sku]);
  if(!r.rows[0])throw new Error('SITE_PRODUCT_NOT_FOUND');
  return r.rows[0];
}

async function findWbTemplate(p:SiteProduct){
  const d=await json('https://content-api.wildberries.ru/content/v2/get/cards/list',{method:'POST',headers:wbHeaders(),body:JSON.stringify({settings:{cursor:{limit:100},filter:{withPhoto:-1},sort:{ascending:false}}})});
  const cards=Array.isArray(d?.cards)?d.cards:[];
  if(!cards.length)return null;
  const q=`${p.title} ${p.description||''} ASA аксессуар декор 3D печать`;
  return cards.map((c:any)=>({c,s:score(q,`${c.title||''} ${c.subjectName||''} ${c.description||''}`)})).sort((a:any,b:any)=>b.s-a.s)[0]?.c||cards[0];
}
async function publishWb(p:SiteProduct){
  const existing=await json('https://content-api.wildberries.ru/content/v2/get/cards/list',{method:'POST',headers:wbHeaders(),body:JSON.stringify({settings:{cursor:{limit:100},filter:{textSearch:p.sku,withPhoto:-1},sort:{ascending:false}}})});
  const same=(existing?.cards||[]).find((c:any)=>String(c.vendorCode||'')===p.sku);
  if(same)return {status:'exists',id:String(same.nmID||''),offerId:p.sku};

  const tpl=await findWbTemplate(p); if(!tpl)throw new Error('WB_TEMPLATE_NOT_FOUND');
  const specs=parseSpecs(p.specs);
  const pack=parsePackageSpec(p.specs);
  const dims={length:pack.length,width:pack.width,height:pack.height,weightBrutto:pack.weightG/1000};
  const characteristics=(Array.isArray(tpl.characteristics)?tpl.characteristics:[]).map((x:any)=>({...x}));
  const payload=[{
    subjectID:Number(tpl.subjectID||0),
    variants:[{
      vendorCode:p.sku,
      brand:String(tpl.brand||'Нет бренда'),
      title:p.title.slice(0,60),
      description:p.description.slice(0,5000),
      dimensions:dims,
      characteristics,
      sizes:[{techSize:'',wbSize:'',price:p.price,skus:[]}],
      kizMarked:false
    }]
  }];
  if(!payload[0].subjectID)throw new Error('WB_SUBJECT_ID_MISSING');
  await json('https://content-api.wildberries.ru/content/v2/cards/upload',{method:'POST',headers:wbHeaders(),body:JSON.stringify(payload)});

  // Card creation is asynchronous. Try to attach the public image if the card becomes visible quickly.
  const image=absImage(p.imageUrl); let nmID='';
  for(let i=0;i<4;i++){
    await new Promise(r=>setTimeout(r,5000));
    const list=await json('https://content-api.wildberries.ru/content/v2/get/cards/list',{method:'POST',headers:wbHeaders(),body:JSON.stringify({settings:{cursor:{limit:100},filter:{textSearch:p.sku,withPhoto:-1},sort:{ascending:false}}})});
    const card=(list?.cards||[]).find((c:any)=>String(c.vendorCode||'')===p.sku);
    if(card){nmID=String(card.nmID||'');break}
  }
  if(nmID&&image){
    try{
      await json('https://content-api.wildberries.ru/content/v3/media/save',{method:'POST',headers:wbHeaders(),body:JSON.stringify({nmId:Number(nmID),data:[image]})});
    }catch{}
  }
  return {status:'submitted',id:nmID||null,offerId:p.sku,templateNmID:tpl.nmID||null,package:dims,specs};
}

async function getOzonTemplate(p:SiteProduct){
  const ringIntent=/кольц/i.test(`${p.title} ${p.description||''}`);
  const preferred=ringIntent?[]:[process.env.OZON_PRODUCT_TEMPLATE_OFFER?.trim(),'DAK-VASE-SHELL-ASA-WH-001','DAK123456'].filter(Boolean) as string[];
  for(const offer of preferred){
    try{
      const info=await json('https://api-seller.ozon.ru/v3/product/info/list',{method:'POST',headers:ozonHeaders(),body:JSON.stringify({offer_id:[offer],product_id:[],sku:[]})});
      const pi=(info?.items||info?.result?.items||[])[0];
      const productId=Number(pi?.id||pi?.product_id||0);
      if(!productId)continue;
      const attrs=await json('https://api-seller.ozon.ru/v4/product/info/attributes',{method:'POST',headers:ozonHeaders(),body:JSON.stringify({filter:{product_id:[productId]},limit:10})});
      const a=((Array.isArray(attrs?.result)?attrs.result:(attrs?.result?.items||attrs?.items||[])))[0];
      if(a)return {a:{...a,offer_id:offer},pi};
    }catch{}
  }

  const list=await json('https://api-seller.ozon.ru/v3/product/list',{method:'POST',headers:ozonHeaders(),body:JSON.stringify({filter:{visibility:'ALL'},last_id:'',limit:100})});
  const items=list?.result?.items||list?.items||[]; if(!items.length)return null;
  const ids=items.map((x:any)=>Number(x.product_id||x.id)).filter((x:number)=>x>0);
  const attrs=await json('https://api-seller.ozon.ru/v4/product/info/attributes',{method:'POST',headers:ozonHeaders(),body:JSON.stringify({filter:{product_id:ids},limit:Math.min(1000,ids.length)})});
  const ai=(Array.isArray(attrs?.result)?attrs.result:(attrs?.result?.items||attrs?.items||[]));
  const q=`${p.title} ${p.description||''} ASA аксессуар декор 3D печать`;
  let ranked=ai.map((a:any)=>({a,s:score(q,`${a.name||''} ${JSON.stringify(a.attributes||[])}`)})).sort((x:any,y:any)=>y.s-x.s);
  if(ringIntent){
    const ringRanked=ranked.filter((x:any)=>/кольц|бижутер|украшен/i.test(`${x.a?.name||''} ${JSON.stringify(x.a?.attributes||[])}`));
    if(ringRanked.length)ranked=ringRanked;
  }
  const best=ranked[0]?.a;
  if(!best){
    if(!ringIntent)return null;
    const tree=await json('https://api-seller.ozon.ru/v1/description-category/tree',{method:'POST',headers:ozonHeaders(),body:JSON.stringify({language:'RU'})});
    const flat:any[]=[];
    const walk=(nodes:any[])=>{for(const n of (nodes||[])){if(Number(n?.description_category_id)>0&&Number(n?.type_id)>0)flat.push(n);if(Array.isArray(n?.children))walk(n.children)}};
    walk(tree?.result||[]);
    const candidates=flat.filter((n:any)=>/кольц/i.test(`${n?.category_name||''} ${n?.type_name||''}`));
    const chosen=candidates.sort((x:any,y:any)=>score('кольца украшения бижутерия',`${y?.category_name||''} ${y?.type_name||''}`)-score('кольца украшения бижутерия',`${x?.category_name||''} ${x?.type_name||''}`))[0];
    if(!chosen)return null;
    return {a:{description_category_id:Number(chosen.description_category_id),type_id:Number(chosen.type_id),attributes:[],offer_id:null,name:`${chosen.category_name||''} ${chosen.type_name||''}`},pi:{}};
  }
  const source=items.find((x:any)=>Number(x.product_id||x.id)===Number(best.id));
  const offer=String(best.offer_id||source?.offer_id||'');
  const info=offer?await json('https://api-seller.ozon.ru/v3/product/info/list',{method:'POST',headers:ozonHeaders(),body:JSON.stringify({offer_id:[offer],product_id:[],sku:[]})}):{};
  const pi=(info?.items||info?.result?.items||[])[0]||{};
  return {a:{...best,offer_id:offer},pi};
}
function updateAttr(attrs:any[],nameRx:RegExp,value:string){
  let done=false;
  const out=(Array.isArray(attrs)?attrs:[]).map((a:any)=>{
    if(done||!nameRx.test(String(a?.name||'')))return a;
    done=true; return {...a,values:[{value}]};
  });
  return out;
}
async function publishOzon(p:SiteProduct){
  const exist=await json('https://api-seller.ozon.ru/v3/product/info/list',{method:'POST',headers:ozonHeaders(),body:JSON.stringify({offer_id:[p.sku],product_id:[],sku:[]})}).catch(()=>({}));
  const same=(exist?.items||exist?.result?.items||[])[0];
  if(same && p.sku!=='dskgothring1')return {status:'exists',id:String(same.id||same.product_id||''),offerId:p.sku};

  const tpl=await getOzonTemplate(p); if(!tpl)throw new Error('OZON_TEMPLATE_NOT_FOUND');
  const a=tpl.a, pi=tpl.pi||{};
  let attrs=Array.isArray(a.attributes)?a.attributes.map((x:any)=>({...x})):[];

  // Reuse category-compatible required values from a seller's existing similar card,
  // but replace common textual fields when the API exposes their names.
  attrs=updateAttr(attrs,/материал/i,'ASA пластик');
  attrs=updateAttr(attrs,/назван|наименован/i,p.title);
  attrs=updateAttr(attrs,/описан/i,p.description);

  const image=absImage(p.imageUrl);
  const pack=parsePackageSpec(p.specs);
  const item:any={
    attributes:attrs,
    barcode:'',
    description_category_id:Number(a.description_category_id||pi.description_category_id||0),
    type_id:Number(a.type_id||pi.type_id||0),
    color_image:'',
    complex_attributes:Array.isArray(a.complex_attributes)?a.complex_attributes:[],
    currency_code:'RUB',
    depth:Math.round(pack.length*10),
    dimension_unit:'mm',
    height:Math.round(pack.height*10),
    width:Math.round(pack.width*10),
    images:image?[image]:[],
    name:p.title.slice(0,500),
    offer_id:p.sku,
    old_price:'0',
    price:String(p.price),
    primary_image:image||'',
    vat:'0',
    weight:Math.round(pack.weightG),
    weight_unit:'g'
  };
  if(!item.description_category_id||!item.type_id)throw new Error('OZON_TEMPLATE_CATEGORY_MISSING');
  const r=await json('https://api-seller.ozon.ru/v3/product/import',{method:'POST',headers:ozonHeaders(),body:JSON.stringify({items:[item]})});
  const taskId=Number(r?.result?.task_id||r?.task_id||0);
  if(!taskId)return {status:'submitted',offerId:p.sku,taskId:null,templateOfferId:a.offer_id||null};
  let info:any=null;
  for(let i=0;i<6;i++){
    await new Promise(resolve=>setTimeout(resolve,2500));
    info=await json('https://api-seller.ozon.ru/v1/product/import/info',{method:'POST',headers:ozonHeaders(),body:JSON.stringify({task_id:taskId})});
    const items=info?.result?.items||[];
    const current=items.find((x:any)=>String(x?.offer_id||'')===p.sku)||items[0];
    const errors=Array.isArray(current?.errors)?current.errors:[];
    const status=String(current?.status||'').toLowerCase();
    if(errors.length){
      throw new Error('OZON_IMPORT_'+JSON.stringify({taskId,status,errors,category:item.description_category_id,typeId:item.type_id,template:a.offer_id||null}).slice(0,4000));
    }
    if(['imported','success','accepted','processed'].includes(status)){
      return {status:'accepted',offerId:p.sku,taskId,productId:current?.product_id||null,templateOfferId:a.offer_id||null,category:item.description_category_id,typeId:item.type_id};
    }
  }
  return {status:'submitted',offerId:p.sku,taskId,templateOfferId:a.offer_id||null,importInfo:info};
}

async function saveAttempt(sku:string,mp:string,status:string,result:any,error?:string){
  const pool=getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_publish_attempts(
    id BIGSERIAL PRIMARY KEY, sku TEXT NOT NULL, marketplace TEXT NOT NULL, status TEXT NOT NULL,
    result JSONB NOT NULL DEFAULT '{}'::jsonb, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`INSERT INTO marketplace_publish_attempts(sku,marketplace,status,result,error) VALUES($1,$2,$3,$4::jsonb,$5)`,[sku,mp,status,JSON.stringify(result||{}),error||null]);
}
export async function publishSiteProductToMarketplaces(sku:string){
  const p=await loadProduct(sku);
  const out:any={sku,wb:null,ozon:null};
  for(const mp of ['wb','ozon'] as const){
    const already=await getPool().query(`SELECT 1 FROM marketplace_publish_attempts WHERE sku=$1 AND marketplace=$2 AND status IN ('exists','accepted','imported') LIMIT 1`,[sku,mp]).catch(()=>({rows:[]}));
    if((already as any).rows?.length){out[mp]={status:'already_done'};continue}
    try{
      const r=mp==='wb'?await publishWb(p):await publishOzon(p);
      out[mp]=r; await saveAttempt(sku,mp,String(r.status||'submitted'),r);
    }catch(e:any){
      const msg=String(e?.message||e); out[mp]={status:'error',error:msg}; await saveAttempt(sku,mp,'error',{},msg);
    }
  }
  return out;
}
