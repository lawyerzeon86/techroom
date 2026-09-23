import { NextRequest, NextResponse } from "next/server";
import { getOzonAccrualsByDay, getOzonAccrualTypes, isOzonConfigured } from "../../../../lib/ozon";
export const runtime="nodejs"; export const dynamic="force-dynamic";
const num=(v:any)=>Number(v?.amount??v??0)||0;
async function day(date:string){let last="";const out:any[]=[];for(let i=0;i<100;i++){const r=await getOzonAccrualsByDay(date,last);out.push(...(r?.accruals??[]));const next=String(r?.last_id??"");if(!next||next===last)break;last=next;}return out;}
export async function GET(request:NextRequest){
 if(!isOzonConfigured())return NextResponse.json({ok:false,error:"OZON_NOT_CONFIGURED"},{status:503});
 const now=new Date();const df=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
 const from=new Date(request.nextUrl.searchParams.get("from")??df.toISOString());const to=new Date(request.nextUrl.searchParams.get("to")??now.toISOString());
 try{
  let types:any={};try{const tr=await getOzonAccrualTypes();for(const t of(tr?.types??tr?.accrual_types??[])){types[String(t.id??t.accrual_id??t.type_id)]=t.name??t.title??t.description;}}catch{}
  const all:any[]=[];for(let d=new Date(Date.UTC(from.getUTCFullYear(),from.getUTCMonth(),from.getUTCDate()));d<=to;d.setUTCDate(d.getUTCDate()+1)){all.push(...await day(d.toISOString().slice(0,10)));}
  const by:Record<string,{count:number;amount:number}>={};const details:Record<string,{count:number;amount:number}>={};let total=0,sales=0,services=0; const add=(name:string,value:any)=>{const amount=num(value);if(!amount)return;details[name]??={count:0,amount:0};details[name].count++;details[name].amount+=amount;};
  for(const a of all){const amount=num(a.total_amount);total+=amount;const id=String(a.accrual_id??a.type_id??"other");const name=types[id]??a.accrued_category??("Начисление "+id);by[name]??={count:0,amount:0};by[name].count++;by[name].amount+=amount;
   const p=a?.posting?.products??[];for(const x of p){sales+=num(x?.sale?.seller_price??x?.seller_price);services+=num(x?.delivery?.total_accrued);for(const fg of(x?.item_fees?.fees??[]))for(const fee of(fg?.fees??[]))services+=num(fee?.accrued);}
   services+=num(a?.non_item_fee?.accrued);for(const cf of(a?.container_fees??[]))services+=num(cf?.accrued??cf?.total_amount);
  }
  const byType=Object.entries(by).map(([type,v])=>({type,count:v.count,amount:Math.round(v.amount*100)/100})).sort((a,b)=>Math.abs(b.amount)-Math.abs(a.amount));
  return NextResponse.json({ok:true,from:from.toISOString(),to:to.toISOString(),summary:{transactionCount:all.length,netTransactionAmount:Math.round(total*100)/100,accrualsForSale:Math.round(sales*100)/100,services:Math.round(services*100)/100,byType}});
 }catch(error){const message=error instanceof Error?error.message:"OZON_REQUEST_FAILED";console.error("[ozon-finance]",message);return NextResponse.json({ok:false,error:message},{status:502});}
}