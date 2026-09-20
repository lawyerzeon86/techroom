import { NextResponse } from 'next/server';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const NONCE="Dm7adMBKcjCc8vPxPKtn2dx7rIzlfvaJ";
function headers(){return {'Client-Id':process.env.OZON_CLIENT_ID||'','Api-Key':process.env.OZON_API_KEY||'','Content-Type':'application/json'}}

async function ozon(path:string,body:any){
  const r=await fetch('https://api-seller.ozon.ru'+path,{method:'POST',headers:headers(),body:JSON.stringify(body),cache:'no-store'});
  const text=await r.text();let data:any={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!r.ok)throw new Error('OZON_'+r.status+': '+String(data?.message||data?.error||text).slice(0,1000));
  return data;
}

function flatten(nodes:any[],path:string[]=[]){
  const out:any[]=[];
  for(const n of Array.isArray(nodes)?nodes:[]){
    const title=String(n?.category_name||n?.name||n?.title||'');
    const p=[...path,title].filter(Boolean);
    const types=Array.isArray(n?.type)?n.type:(Array.isArray(n?.types)?n.types:[]);
    for(const t of types)out.push({
      description_category_id:Number(n?.description_category_id||n?.category_id||n?.id||0),
      category:title,
      path:p.join(' > '),
      type_id:Number(t?.type_id||t?.id||0),
      type_name:String(t?.type_name||t?.name||t?.title||'')
    });
    const children=n?.children||n?.childs||n?.subcategories||[];
    out.push(...flatten(children,p));
  }
  return out;
}

export async function POST(req:Request){
  if(req.headers.get('x-techroom-task')!==NONCE)return NextResponse.json({error:'forbidden'},{status:403});
  try{
    const body=await req.json().catch(()=>({}));
    if(body?.action!=='inspect')return NextResponse.json({error:'bad action'},{status:400});
    const tree=await ozon('/v1/description-category/tree',{language:'RU'});
    const all=flatten(tree?.result||tree?.categories||tree?.items||[]);
    const terms=['заглуш','фара','освещ','автозапчаст','кузов','электрооборуд'];
    const scored=all.map((x:any)=>{
      const s=(x.path+' '+x.type_name).toLowerCase();
      let score=0;for(const term of terms)if(s.includes(term))score++;
      if(s.includes('запчаст'))score+=2;
      if(s.includes('автомоб'))score+=2;
      return {...x,score};
    }).filter((x:any)=>x.description_category_id&&x.type_id&&x.score>0)
      .sort((a:any,b:any)=>b.score-a.score||a.path.localeCompare(b.path,'ru')).slice(0,80);
    return NextResponse.json({count:all.length,candidates:scored});
  }catch(e:any){return NextResponse.json({error:String(e?.message||e)},{status:500})}
}
