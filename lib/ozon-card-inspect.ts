function headers(){return {'Client-Id':process.env.OZON_CLIENT_ID||'','Api-Key':process.env.OZON_API_KEY||'','Content-Type':'application/json'}}

async function ozon(path:string,body:any){
  const r=await fetch('https://api-seller.ozon.ru'+path,{method:'POST',headers:headers(),body:JSON.stringify(body),cache:'no-store'});
  const text=await r.text();let data:any={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!r.ok)throw new Error('OZON_'+r.status+': '+String(data?.message||data?.error||text).slice(0,1000));
  return data;
}

function flatten(nodes:any[],path:string[]=[]):any[]{
  const out:any[]=[];
  for(const n of Array.isArray(nodes)?nodes:[]){
    const title=String(n?.category_name||n?.name||n?.title||'');
    const p=[...path,title].filter(Boolean);
    const nodeTypeId=Number(n?.type_id||n?.type?.id||0);
    if(nodeTypeId)out.push({
      description_category_id:Number(n?.description_category_id||n?.category_id||n?.id||0),
      category:title,path:p.join(' > '),type_id:nodeTypeId,
      type_name:String(n?.type_name||n?.type?.name||n?.type?.title||title)
    });
    const types=Array.isArray(n?.type)?n.type:(Array.isArray(n?.types)?n.types:[]);
    for(const t of types)out.push({
      description_category_id:Number(n?.description_category_id||n?.category_id||n?.id||0),
      category:title,path:p.join(' > '),
      type_id:Number(t?.type_id||t?.id||0),
      type_name:String(t?.type_name||t?.name||t?.title||'')
    });
    out.push(...flatten(n?.children||n?.childs||n?.subcategories||[],p));
  }
  return out;
}

export async function inspectOzonAutoPartCategory(){
  const tree=await ozon('/v1/description-category/tree',{language:'RU'});
  const all=flatten(tree?.result||tree?.categories||tree?.items||[]);
  const terms=['заглуш','фара','освещ','автозапчаст','кузов','электрооборуд','оптик','детали'];
  const candidates=all.map((x:any)=>{
    const s=(x.path+' '+x.type_name).toLowerCase();
    let score=0;
    if(s.includes('авто'))score+=3;
    if(s.includes('запчаст'))score+=3;
    if(s.includes('фара'))score+=6;
    if(s.includes('освещ'))score+=4;
    if(s.includes('электрооборуд'))score+=3;
    if(s.includes('заглуш'))score+=8;
    if(s.includes('детали'))score+=1;
    return {...x,score};
  }).filter((x:any)=>x.description_category_id&&x.type_id&&x.score>0)
    .sort((a:any,b:any)=>b.score-a.score||a.path.localeCompare(b.path,'ru')).slice(0,20);

  const details=[];
  for(const c of candidates.slice(0,8)){
    try{
      const a=await ozon('/v1/description-category/attribute',{description_category_id:c.description_category_id,type_id:c.type_id,language:'RU'});
      const attrs=(a?.result||a?.attributes||[]).map((x:any)=>({
        id:Number(x?.id||0),
        name:String(x?.name||''),
        required:Boolean(x?.is_required),
        dictionaryId:Number(x?.dictionary_id||0),
        type:String(x?.type||''),
        maxValueCount:Number(x?.max_value_count||0),
        groupName:String(x?.group_name||'')
      })).filter((x:any)=>x.required||/бренд|материал|страна|количество|комплект|цвет|описание|артикул|модель|марка|назначение|вид|тип|тн|сертифик/i.test(x.name));
      details.push({...c,attrs});
    }catch(e:any){details.push({...c,error:String(e?.message||e)})}
  }
  return {count:all.length,samples:all.slice(0,30),candidates,details};
}
