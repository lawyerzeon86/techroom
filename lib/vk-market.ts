import { getProducts } from './marketplace-content';

const VK_API='https://api.vk.com/method';
const VK_VERSION=process.env.VK_API_VERSION?.trim()||'5.199';

function env(name:string){const v=process.env[name]?.trim();if(!v)throw new Error(`${name}_NOT_CONFIGURED`);return v}
function groupId(){return Number(env('VK_GROUP_ID'))}
function token(){return env('VK_ACCESS_TOKEN')}

async function vk(method:string,params:Record<string,any>={}){
  const body=new URLSearchParams();
  for(const [k,v] of Object.entries({...params,access_token:token(),v:VK_VERSION})){
    if(v===undefined||v===null||v==='')continue;
    body.set(k,typeof v==='object'?JSON.stringify(v):String(v));
  }
  const res=await fetch(`${VK_API}/${method}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,cache:'no-store'});
  const data:any=await res.json().catch(()=>({}));
  if(data?.error)throw new Error(`VK_${data.error.error_code}: ${data.error.error_msg}`);
  return data?.response;
}

export function vkConfigured(){return Boolean(process.env.VK_GROUP_ID?.trim()&&process.env.VK_ACCESS_TOKEN?.trim())}

export async function testVk(){
  const response=await vk('groups.getById',{group_id:groupId()});
  const item=Array.isArray(response?.groups)?response.groups[0]:(Array.isArray(response)?response[0]:response);
  return {ok:true,group:item||response};
}

async function getVkItems(){
  const ownerId=-Math.abs(groupId());
  const response=await vk('market.get',{owner_id:ownerId,count:200,extended:0});
  return Array.isArray(response?.items)?response.items:[];
}

function normalizeText(s:any,max:number){return String(s||'').replace(/\s+/g,' ').trim().slice(0,max)}
function skuFromVk(item:any){
  const m=String(item?.description||'').match(/(?:SKU|Артикул)\s*:\s*([^\s]+)/i);
  return m?m[1]:'';
}

async function uploadMarketPhoto(url:string){
  const gid=groupId();
  const server=await vk('photos.getMarketUploadServer',{group_id:gid,main_photo:1,crop_x:0,crop_y:0,crop_width:1000});
  if(!server?.upload_url)throw new Error('VK_UPLOAD_URL_NOT_FOUND');
  const imageRes=await fetch(url,{cache:'no-store'});
  if(!imageRes.ok)throw new Error(`IMAGE_DOWNLOAD_${imageRes.status}`);
  const blob=await imageRes.blob();
  const form=new FormData();
  form.append('file',blob,'product.jpg');
  const uploaded:any=await fetch(server.upload_url,{method:'POST',body:form}).then(r=>r.json());
  const saved=await vk('photos.saveMarketPhoto',{group_id:gid,photo:uploaded.photo,server:uploaded.server,hash:uploaded.hash,crop_data:uploaded.crop_data,crop_hash:uploaded.crop_hash});
  const photo=Array.isArray(saved)?saved[0]:saved;
  return photo?.id?Number(photo.id):undefined;
}

async function resolveCategoryId(title:string,description:string){
  const forced=Number(process.env.VK_MARKET_CATEGORY_ID||0);
  if(forced>0)return forced;
  const cats=await vk('market.getCategories',{count:1000});
  const items=Array.isArray(cats?.items)?cats.items:[];
  const hay=`${title} ${description}`.toLowerCase();
  let best:any=null,bestScore=-1;
  for(const c of items){
    const text=`${c.name||''} ${c.section?.name||''}`.toLowerCase();
    let score=0;
    for(const w of hay.split(/[^a-zа-я0-9]+/i).filter((x:string)=>x.length>3))if(text.includes(w))score++;
    if(score>bestScore){best=c;bestScore=score}
  }
  if(best?.id)return Number(best.id);
  throw new Error('VK_MARKET_CATEGORY_NOT_FOUND');
}

export async function syncOzonToVk(limit=100){
  if(!vkConfigured())throw new Error('VK_NOT_CONFIGURED');
  const ozon=await getProducts('ozon','',Math.max(1,Math.min(100,limit)));
  const existing=await getVkItems();
  const bySku=new Map(existing.map((x:any)=>[skuFromVk(x),x]).filter(([sku]:any)=>Boolean(sku)));
  const ownerId=-Math.abs(groupId());
  let created=0,updated=0,failed=0;
  const errors:any[]=[];

  for(const p of ozon){
    try{
      const sku=String(p.offerId||p.sku||p.id||'').trim();
      if(!sku)continue;
      const title=normalizeText(p.title||sku,100);
      const description=normalizeText(`${p.description||''}\n\nАртикул: ${sku}`,4000);
      const price=Math.max(1,Math.round(Number((p as any).price||0)||1));
      const categoryId=await resolveCategoryId(title,description);
      let mainPhotoId:number|undefined;
      const image=Array.isArray((p as any).images)?(p as any).images[0]:undefined;
      if(image){try{mainPhotoId=await uploadMarketPhoto(String(image))}catch{}}
      const current:any=bySku.get(sku);
      if(current){
        await vk('market.edit',{owner_id:ownerId,item_id:current.id,name:title,description,category_id:categoryId,price,main_photo_id:mainPhotoId,deleted:0});
        updated++;
      }else{
        const added=await vk('market.add',{owner_id:ownerId,name:title,description,category_id:categoryId,price,main_photo_id:mainPhotoId});
        if(added?.market_item_id||added)created++;
      }
    }catch(e:any){failed++;errors.push({id:String((p as any)?.id||''),error:String(e?.message||e)})}
  }
  return {ok:true,total:ozon.length,created,updated,failed,errors:errors.slice(0,20)};
}
