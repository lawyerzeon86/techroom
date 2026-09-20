function headers(){return {'Client-Id':process.env.OZON_CLIENT_ID||'','Api-Key':process.env.OZON_API_KEY||'','Content-Type':'application/json'}}

async function ozon(path:string,body:any){
  const r=await fetch('https://api-seller.ozon.ru'+path,{method:'POST',headers:headers(),body:JSON.stringify(body),cache:'no-store'});
  const text=await r.text();let data:any={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!r.ok)throw new Error('OZON_'+r.status+': '+String(data?.message||data?.error||text).slice(0,1000));
  return data;
}

function flatten(nodes:any[],path:string[]=[],inheritedCategoryId=0):any[]{
  const out:any[]=[];
  for(const n of Array.isArray(nodes)?nodes:[]){
    const title=String(n?.category_name||n?.name||n?.title||'');
    const p=[...path,title].filter(Boolean);
    const categoryId=Number(n?.description_category_id||n?.category_id||n?.id||inheritedCategoryId||0);
    const nodeTypeId=Number(n?.type_id||n?.type?.id||0);
    if(nodeTypeId)out.push({
      description_category_id:categoryId,
      category:title,path:p.join(' > '),type_id:nodeTypeId,
      type_name:String(n?.type_name||n?.type?.name||n?.type?.title||title)
    });
    const types=Array.isArray(n?.type)?n.type:(Array.isArray(n?.types)?n.types:[]);
    for(const t of types)out.push({
      description_category_id:categoryId,
      category:title,path:p.join(' > '),
      type_id:Number(t?.type_id||t?.id||0),
      type_name:String(t?.type_name||t?.name||t?.title||'')
    });
    out.push(...flatten(n?.children||n?.childs||n?.subcategories||[],p,categoryId));
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
  const lighting=all.filter((x:any)=>{const s=(x.path+' '+x.type_name).toLowerCase();return /фар|оптик|освещ|ксенон|блок розжига|заглушк/.test(s)&&/автотовар|запчаст/.test(s)}).slice(0,120);
  return {count:all.length,lighting,candidates,details};
}


async function values(attributeId:number,categoryId:number,typeId:number){
  const out:any[]=[];let last=0;
  for(let page=0;page<100;page++){
    const d=await ozon('/v1/description-category/attribute/values',{
      attribute_id:attributeId,description_category_id:categoryId,type_id:typeId,
      language:'RU',last_value_id:last,limit:100
    });
    const rows=d?.result||d?.values||[];
    if(!Array.isArray(rows)||!rows.length)break;
    out.push(...rows.map((x:any)=>({id:Number(x?.id||x?.value_id||x?.dictionary_value_id||0),value:String(x?.value||x?.name||'')})));
    const next=Number(rows[rows.length-1]?.id||rows[rows.length-1]?.value_id||0);
    if(!next||next===last||rows.length<100)break; last=next;
  }
  return out;
}

export async function inspectOzonHeadlightCover(){
  const description_category_id=17028756,type_id=971102695;
  const a=await ozon('/v1/description-category/attribute',{description_category_id,type_id,language:'RU'});
  const attrs=(a?.result||a?.attributes||[]).map((x:any)=>({
    id:Number(x?.id||0),name:String(x?.name||''),required:Boolean(x?.is_required),
    dictionaryId:Number(x?.dictionary_id||0),type:String(x?.type||'')
  }));
  const important=attrs.filter((x:any)=>x.required||/бренд|материал|количество|комплект|цвет|марка|модель|тн|вид запчасти|страна/i.test(x.name));
  const dictionaries:any={};
  for(const x of important.filter((x:any)=>x.dictionaryId)){
    const all=await values(x.id,description_category_id,type_id);
    let filtered=all;
    if(x.id===22232)filtered=all.filter((v:any)=>/8512\s*90|851290|3926300000|9405920008/i.test(v.value)).slice(0,50);
    else if(x.id===85)filtered=all.filter((v:any)=>/нет бренда|без бренда|techroom/i.test(v.value)).slice(0,30);
    else if(x.id===7199||/материал/i.test(x.name))filtered=all.filter((v:any)=>/asa|пласт/i.test(v.value)).slice(0,30);
    else if(x.id===7202||/количество/i.test(x.name))filtered=all.filter((v:any)=>/^2$|2 шт/i.test(v.value)).slice(0,20);
    else filtered=all.slice(0,30);
    dictionaries[x.id]={name:x.name,count:all.length,values:filtered};
  }
  return {description_category_id,type_id,type_name:'Кожух фары',attributes:important,dictionaries};
}


export async function inspectOzonSellerDefaults(){
  const offers=['R8W0821653','DAK8T54A53A','FenderAudiA4B8front','AUDI-ARCH-A4B8-A58T','DAK123456'];
  const d=await ozon('/v3/product/info/list',{offer_id:offers,product_id:[],sku:[]});
  const rows=(d?.items||d?.result?.items||[]).map((x:any)=>({
    offer_id:String(x?.offer_id||''),
    vat:String(x?.vat??''),
    currency_code:String(x?.currency_code||''),
    price:String(x?.price||'')
  }));
  return {rows};
}


export async function inspectOzonExternalDecor(){
  const tree=await ozon('/v1/description-category/tree',{language:'RU'});
  const all=flatten(tree?.result||tree?.categories||tree?.items||[]);
  const picks=all.filter((x:any)=>{
    const s=(x.path+' '+x.type_name).toLowerCase();
    return /автотовары/.test(s)&&/тюнинг|внешн|декор/.test(s);
  }).slice(0,200);
  const details=[];
  for(const p of picks.slice(0,30)){
    try{
      const a=await ozon('/v1/description-category/attribute',{description_category_id:p.description_category_id,type_id:p.type_id,language:'RU'});
      const attrs=(a?.result||a?.attributes||[]).map((x:any)=>({id:Number(x?.id||0),name:String(x?.name||''),required:Boolean(x?.is_required),dictionaryId:Number(x?.dictionary_id||0),type:String(x?.type||'')}))
        .filter((x:any)=>x.required||/бренд|материал|количество|комплект|цвет|марка|модель|тн|тип|партномер/i.test(x.name));
      details.push({...p,attrs});
    }catch(e:any){details.push({...p,error:String(e?.message||e)})}
  }
  return {picks,details};
}


export async function publishOzonAudiXenonCover(){
  const offerId='AUDI-A4B8-XENON-COVER-2PCS';
  let existing:any=null;
  try{
    const x=await ozon('/v3/product/info/list',{offer_id:[offerId],product_id:[],sku:[]});
    existing=(x?.items||x?.result?.items||[])[0]||null;
  }catch{}
  const item:any={
    attributes:[
      {id:8229,complex_id:0,values:[{dictionary_value_id:971006634,value:'Накладка на автомобиль'}]},
      {id:85,complex_id:0,values:[{dictionary_value_id:126745801,value:'Нет бренда'}]},
      {id:9048,complex_id:0,values:[{value:'Заглушка блока ксенона Audi A4 B8, комплект 2 шт.'}]},
      {id:23536,complex_id:0,values:[{value:'false'}]},
      {id:22232,complex_id:0,values:[{dictionary_value_id:971397975,value:'3926300000 - Крепежные изделия и фурнитура для мебели, транспортных средств или аналогичные изделия'}]},
      {id:22916,complex_id:0,values:[{dictionary_value_id:58097,value:'Audi'}]},
      {id:7199,complex_id:0,values:[{dictionary_value_id:62015,value:'Пластик'}]},
      {id:7202,complex_id:0,values:[{dictionary_value_id:45566,value:'2'}]},
      {id:4384,complex_id:0,values:[{value:'Заглушка блока ксенона — 2 шт.'}]}
    ],
    barcode:'',
    description_category_id:17028755,
    type_id:971006634,
    color_image:'',
    complex_attributes:[],
    currency_code:'RUB',
    depth:120,
    dimension_unit:'mm',
    height:30,
    images:[
      'https://d2ol7oe51mr4n9.cloudfront.net/user_3J9hS8Vj8qs7xcw1iabOO1dMJk0/081547c2-0d10-417b-a7ef-ffa636739218.jpg',
      'https://d2ol7oe51mr4n9.cloudfront.net/user_3J9hS8Vj8qs7xcw1iabOO1dMJk0/7cb00e8c-d43f-4c43-a965-5793f5cce1b7.jpg',
      'https://d2ol7oe51mr4n9.cloudfront.net/user_3J9hS8Vj8qs7xcw1iabOO1dMJk0/467c675c-2827-42d3-a4dc-c18605c88f5b.jpg'
    ],
    name:'Заглушка блока ксенона Audi A4 B8, 2 шт., ASA пластик',
    offer_id:offerId,
    old_price:'0',
    price:'2000',
    primary_image:'https://d2ol7oe51mr4n9.cloudfront.net/user_3J9hS8Vj8qs7xcw1iabOO1dMJk0/081547c2-0d10-417b-a7ef-ffa636739218.jpg',
    vat:'0',
    weight:50,
    weight_unit:'g',
    width:120
  };
  const imported=await ozon('/v3/product/import',{items:[item]});
  const taskId=Number(imported?.result?.task_id||imported?.task_id||0);
  let task:any=null;
  if(taskId){
    await new Promise(r=>setTimeout(r,8000));
    try{task=await ozon('/v1/product/import/info',{task_id:taskId})}catch(e:any){task={error:String(e?.message||e)}}
  }
  let current:any=null;
  try{
    const x=await ozon('/v3/product/info/list',{offer_id:[offerId],product_id:[],sku:[]});
    current=(x?.items||x?.result?.items||[])[0]||null;
  }catch(e:any){current={error:String(e?.message||e)}}
  return {offerId,existing:Boolean(existing),imported,task,current};
}
