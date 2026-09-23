import { NextResponse } from "next/server";
import { getOzonAccrualsByDay,getOzonAccrualTypes,isOzonConfigured } from "../../../../../lib/ozon";
import { ensureSchema,getPool } from "../../../../../lib/db";
import { isAdminSession } from "../../../../../lib/security";
export const runtime="nodejs";export const dynamic="force-dynamic";
const n=(v:any)=>Number(v?.amount??v??0)||0;const round=(v:number)=>Math.round(v*100)/100;
async function day(date:string){let last="";const out:any[]=[];for(let i=0;i<100;i++){const r=await getOzonAccrualsByDay(date,last);out.push(...(r?.accruals??[]));const next=String(r?.last_id??"");if(!next||next===last)break;last=next;}return out;}
export async function GET(request:Request){
 if(!isAdminSession(request))return NextResponse.json({ok:false,error:"Требуется вход администратора"},{status:401});
 if(!isOzonConfigured())return NextResponse.json({ok:false,error:"OZON_NOT_CONFIGURED"},{status:503});
 const u=new URL(request.url),now=new Date(),start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));const from=new Date(u.searchParams.get("from")||start.toISOString()),to=new Date(u.searchParams.get("to")||now.toISOString());
 if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||from>to||to.getTime()-from.getTime()>1000*60*60*24*93)return NextResponse.json({ok:false,error:"Некорректный период (максимум 93 дня)"},{status:400});
 try{
  const types:Record<string,string>={};try{const tr=await getOzonAccrualTypes();for(const t of(tr?.types??tr?.accrual_types??[]))types[String(t.id??t.accrual_id??t.type_id)]=t.name??t.title??t.description;}catch{}
  const all:any[]=[];for(let d=new Date(Date.UTC(from.getUTCFullYear(),from.getUTCMonth(),from.getUTCDate()));d<=to;d.setUTCDate(d.getUTCDate()+1))all.push(...await day(d.toISOString().slice(0,10)));
  const groups:Record<string,{count:number;amount:number}>={},sku:Record<string,any>={};let total=0,sales=0,services=0,points=0;
  const add=(name:string,amount:number)=>{if(!amount)return;groups[name]??={count:0,amount:0};groups[name].count++;groups[name].amount+=amount;};
  for(const a of all){const amount=n(a.total_amount),id=String(a.accrual_id??a.type_id??"other"),base=types[id]??a.accrued_category??("Начисление "+id);total+=amount;add(base,amount);if(/балл|point|скидк/i.test(base+" "+(a?.non_item_fee?.name??"")))points+=amount;
   for(const x of(a?.posting?.products??[])){const sale=n(x?.sale?.seller_price??x?.seller_price);let fees=n(x?.delivery?.total_accrued);for(const fg of(x?.item_fees?.fees??[]))for(const fee of(fg?.fees??[]))fees+=n(fee?.accrued);sales+=sale;services+=fees;const code=String(x?.offer_id??x?.sku??x?.product_id??"Без SKU");sku[code]??={sku:code,title:String(x?.name??x?.title??code),qty:0,sales:0,fees:0};sku[code].qty+=Number(x?.quantity??1)||1;sku[code].sales+=sale;sku[code].fees+=fees;}
   services+=n(a?.non_item_fee?.accrued);for(const cf of(a?.container_fees??[]))services+=n(cf?.accrued??cf?.total_amount);
  }
  await ensureSchema();const q=await getPool().query("SELECT sku,title,price FROM products WHERE sku IS NOT NULL");const local:Record<string,any>={};for(const r of q.rows)local[String(r.sku)]={title:r.title,price:Number(r.price)};
  const skuEconomics=Object.values(sku).map((x:any)=>{const net=x.sales+x.fees;return{...x,title:local[x.sku]?.title??x.title,sales:round(x.sales),fees:round(x.fees),net:round(net),techroomPrice:local[x.sku]?.price??null,ozonCostShare:x.sales?round(Math.abs(x.fees)/x.sales*100):0};}).sort((a:any,b:any)=>b.sales-a.sales);
  const byType=Object.entries(groups).map(([type,v])=>({type,count:v.count,amount:round(v.amount)})).sort((a,b)=>Math.abs(b.amount)-Math.abs(a.amount));const pos=byType.filter(x=>x.amount>0).reduce((s,x)=>s+x.amount,0),neg=byType.filter(x=>x.amount<0).reduce((s,x)=>s+x.amount,0),take=sales?Math.abs(services)/sales*100:0;
  const recommendations:any[]=[];if(take>30)recommendations.push({level:"high",title:"Высокие расходы Ozon",text:"Комиссии и логистика составляют "+round(take)+"% продаж. Проверьте самые дорогие SKU и схему поставки."});for(const x of skuEconomics.filter((x:any)=>x.ozonCostShare>30).slice(0,5))recommendations.push({level:"medium",title:"Высокие расходы по "+x.sku,text:"Расходы Ozon составляют "+x.ozonCostShare+"% продаж этого SKU."});if(points)recommendations.push({level:"low",title:"Учтены баллы Ozon",text:"Операции по баллам/скидкам: "+round(points)+" ₽. Контролируйте их отдельно от обычной выручки."});if(!recommendations.length)recommendations.push({level:"low",title:"Добавьте себестоимость",text:"Для чистой прибыли нужна закупочная/производственная себестоимость каждого SKU. Цена TechRoom не используется как себестоимость."});
  return NextResponse.json({ok:true,from:from.toISOString(),to:to.toISOString(),summary:{transactionCount:all.length,netTransactionAmount:round(total),accrualsForSale:round(sales),services:round(services),ozonPoints:round(points),totalPositive:round(pos),totalExpenses:round(neg),takeRate:round(take),byType,breakdown:byType,skuEconomics,recommendations}},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"OZON_REQUEST_FAILED"},{status:502});}
}