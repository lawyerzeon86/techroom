import type { MarketplaceName } from './marketplaces';

export type CommunicationType = 'reviews' | 'questions';

function env(name:string){
  const value=process.env[name]?.trim();
  if(!value) throw new Error(`${name}_NOT_CONFIGURED`);
  return value;
}

async function readJson(res:Response){
  const text=await res.text();
  let data:any={};
  try{ data=text?JSON.parse(text):{}; }catch{ data={raw:text}; }
  if(!res.ok){
    const msg=data?.message||data?.error||data?.detail||data?.errors?.[0]?.message||`HTTP_${res.status}`;
    throw new Error(String(msg));
  }
  return data;
}

function wbToken(){
  return process.env.WB_FEEDBACK_TOKEN?.trim() || env('WB_API_TOKEN');
}

function ozonHeaders(){
  return {
    'Client-Id':env('OZON_CLIENT_ID'),
    'Api-Key':env('OZON_API_KEY'),
    'Content-Type':'application/json',
  };
}

export async function listWildberries(type:CommunicationType){
  const token=wbToken();
  const endpoint=type==='reviews'?'feedbacks':'questions';
  const qs=new URLSearchParams({isAnswered:'false',take:'100',skip:'0',order:'dateDesc'});
  const res=await fetch(`https://feedbacks-api.wildberries.ru/api/v1/${endpoint}?${qs.toString()}`,{
    headers:{Authorization:token},cache:'no-store'
  });
  const data=await readJson(res);
  const raw=type==='reviews'
    ? (data?.data?.feedbacks??data?.feedbacks??[])
    : (data?.data?.questions??data?.questions??[]);
  const items=(Array.isArray(raw)?raw:[]).map((x:any)=>({
    id:String(x.id??''),
    marketplace:'wildberries' as const,
    type,
    text:String(type==='reviews'?(x.text??x.pros??x.cons??''):(x.text??'')),
    rating:type==='reviews'?Number(x.productValuation??x.valuation??x.rating??0):null,
    productName:String(x.productDetails?.productName??x.productName??''),
    sku:String(x.productDetails?.nmId??x.nmId??''),
    article:String(x.productDetails?.supplierArticle??x.article??''),
    createdAt:String(x.createdDate??x.createdAt??x.date??''),
    answer:x.answer?.text??x.answer??null,
    raw:x,
  }));
  return {items,total:Number(data?.data?.countUnanswered??items.length)||items.length};
}

export async function replyWildberries(type:CommunicationType,id:string,text:string){
  const token=wbToken();
  const url=type==='reviews'
    ? 'https://feedbacks-api.wildberries.ru/api/v1/feedbacks/answer'
    : 'https://feedbacks-api.wildberries.ru/api/v1/questions';
  const res=await fetch(url,{
    method:type==='reviews'?'POST':'PATCH',
    headers:{Authorization:token,'Content-Type':'application/json'},
    body:JSON.stringify(type==='reviews'?{id,text}:{id,text,state:'wbRu'}),
    cache:'no-store'
  });
  if(res.status===204) return {ok:true};
  await readJson(res);
  return {ok:true};
}

export async function listOzon(type:CommunicationType){
  const headers=ozonHeaders();
  const url=type==='reviews'
    ? 'https://api-seller.ozon.ru/v2/review/list'
    : 'https://api-seller.ozon.ru/v1/question/list';
  const body=type==='reviews'
    ? {limit:50,sort_dir:'DESC'}
    : {limit:50,sort_dir:'DESC',filter:{status:'NEW'}};
  const res=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),cache:'no-store'});
  const data=await readJson(res);
  const raw=type==='reviews'
    ? (data?.reviews??data?.result?.reviews??[])
    : (data?.questions??data?.result?.questions??[]);
  const items=(Array.isArray(raw)?raw:[]).map((x:any)=>({
    id:String(x.id??x.review_id??x.question_id??''),
    marketplace:'ozon' as const,
    type,
    text:String(x.text??x.question_text??''),
    rating:type==='reviews'?Number(x.rating??0):null,
    productName:String(x.product_name??x.product?.name??''),
    sku:String(x.sku??x.product?.sku??''),
    article:String(x.offer_id??x.product?.offer_id??''),
    createdAt:String(x.published_at??x.created_at??x.date??''),
    answer:x.answer??null,
    raw:x,
  }));
  return {items,total:items.length};
}

export async function replyOzon(type:CommunicationType,id:string,text:string,sku?:string|number|null){
  const headers=ozonHeaders();
  const url=type==='reviews'
    ? 'https://api-seller.ozon.ru/v1/review/comment/create'
    : 'https://api-seller.ozon.ru/v1/question/answer/create';
  let body:any;
  if(type==='reviews') body={review_id:id,text,mark_review_as_processed:true};
  else {
    const numericSku=Number(sku);
    if(!Number.isFinite(numericSku)||numericSku<=0) throw new Error('OZON_SKU_REQUIRED');
    body={question_id:id,sku:numericSku,text};
  }
  const res=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),cache:'no-store'});
  const data=await readJson(res);
  return {ok:true,data};
}

export async function listCommunications(marketplace:MarketplaceName,type:CommunicationType){
  return marketplace==='wildberries'?listWildberries(type):listOzon(type);
}

export async function replyCommunication(input:{marketplace:MarketplaceName;type:CommunicationType;id:string;text:string;sku?:string|number|null}){
  if(input.marketplace==='wildberries') return replyWildberries(input.type,input.id,input.text);
  return replyOzon(input.type,input.id,input.text,input.sku);
}
