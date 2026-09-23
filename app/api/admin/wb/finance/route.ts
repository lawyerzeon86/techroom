import { NextResponse } from "next/server";
import { isAdminSession } from "../../../../../lib/security";
import { ensurePriceSheetSchema } from "../../../../../lib/price-sheet";
import { getPool } from "../../../../../lib/db";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const round=(v:number)=>Math.round(v*100)/100;
const num=(v:any)=>Number(v??0)||0;
const CACHE_TTL_MS=70_000;

function retrySeconds(response:Response){
  const raw=response.headers.get("x-ratelimit-retry")||response.headers.get("retry-after")||"";
  const parsed=Number(raw);
  if(Number.isFinite(parsed)&&parsed>0) return Math.max(1,Math.ceil(parsed));
  const asDate=Date.parse(raw);
  if(Number.isFinite(asDate)) return Math.max(1,Math.ceil((asDate-Date.now())/1000));
  return 60;
}

async function ensureCache(){
  await ensurePriceSheetSchema();
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS wb_finance_cache(
      cache_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getCached(key:string){
  const q=await getPool().query("SELECT payload,fetched_at FROM wb_finance_cache WHERE cache_key=$1",[key]);
  return q.rows[0]||null;
}

async function saveCached(key:string,payload:any){
  await getPool().query(`
    INSERT INTO wb_finance_cache(cache_key,payload,fetched_at)
    VALUES($1,$2::jsonb,NOW())
    ON CONFLICT(cache_key) DO UPDATE SET payload=EXCLUDED.payload,fetched_at=NOW()
  `,[key,JSON.stringify(payload)]);
}

export async function GET(request:Request){
  if(!isAdminSession(request)) return NextResponse.json({ok:false,error:"Требуется вход администратора"},{status:401});
  const token=process.env.WB_API_TOKEN?.trim();
  if(!token) return NextResponse.json({ok:false,error:"WB_API_TOKEN_NOT_CONFIGURED"},{status:503});

  const u=new URL(request.url);
  const now=new Date();
  const from=u.searchParams.get("from")||new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString();
  const to=u.searchParams.get("to")||now.toISOString();
  const fromDate=from.slice(0,10),toDate=to.slice(0,10);
  const key=fromDate+"_"+toDate;

  try{
    await ensureCache();
    const cached=await getCached(key);
    if(cached && Date.now()-new Date(cached.fetched_at).getTime()<CACHE_TTL_MS){
      return NextResponse.json({...cached.payload,cached:true,cacheAgeSeconds:Math.round((Date.now()-new Date(cached.fetched_at).getTime())/1000)},{headers:{"Cache-Control":"no-store"}});
    }

    const response=await fetch("https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed",{
      method:"POST",
      headers:{Authorization:token,"Content-Type":"application/json"},
      body:JSON.stringify({dateFrom:fromDate,dateTo:toDate,limit:100000,rrdId:0,period:"weekly"}),
      cache:"no-store"
    });

    if(response.status===429){
      const retryAfter=retrySeconds(response);
      if(cached){
        return NextResponse.json({...cached.payload,cached:true,rateLimited:true,retryAfter,cacheAgeSeconds:Math.round((Date.now()-new Date(cached.fetched_at).getTime())/1000)},{headers:{"Cache-Control":"no-store","Retry-After":String(retryAfter)}});
      }
      return NextResponse.json({ok:false,error:"WB_RATE_LIMIT",message:"Wildberries временно ограничил запросы. Повторите через "+retryAfter+" сек.",retryAfter},{status:429,headers:{"Retry-After":String(retryAfter)}});
    }

    if(response.status===204){
      const empty={ok:true,from,to,summary:{sales:0,payout:0,commission:0,logistics:0,storage:0,penalties:0,acquiring:0,acceptance:0,deductions:0,returns:0,takeRate:0,operations:0,skuEconomics:[],recommendations:[]}};
      await saveCached(key,empty);
      return NextResponse.json(empty,{headers:{"Cache-Control":"no-store"}});
    }

    if(!response.ok){
      const detail=(await response.text()).slice(0,500);
      const hint=(response.status===401||response.status===403)?" Проверьте, что WB_API_TOKEN имеет категорию «Финансы» и тип Personal/Service.":"";
      throw new Error("WB_API_"+response.status+": "+detail+hint);
    }

    const rows:any[]=await response.json();
    const q=await getPool().query("SELECT sku,title,cost_price FROM price_sheet");
    const costs:Record<string,{title:string;cost:number}>={};
    for(const x of q.rows) costs[String(x.sku)]={title:String(x.title||x.sku),cost:Number(x.cost_price)||0};

    const map:Record<string,any>={};
    let sales=0,commission=0,logistics=0,storage=0,penalties=0,acquiring=0,acceptance=0,deductions=0,payout=0,returns=0;

    for(const x of rows){
      const sku=String(x.supplierArticle??x.nmId??"Без SKU");
      const sale=num(x.retailAmount??x.retailPriceWithDisc);
      const comm=num(x.ppvzSalesCommission);
      const log=num(x.deliveryService??x.rebillLogisticCost);
      const store=num(x.paidStorage);
      const pen=num(x.penalty);
      const acq=num(x.acquiringFee);
      const accept=num(x.paidAcceptance);
      const deduct=num(x.deduction);
      const pay=num(x.forPay);
      const isReturn=/возврат|return/i.test(String(x.docTypeName??""));

      sales+=sale;
      commission+=comm;
      logistics+=log;
      storage+=store;
      penalties+=pen;
      acquiring+=acq;
      acceptance+=accept;
      deductions+=deduct;
      payout+=pay;
      if(isReturn) returns+=Math.abs(sale);

      map[sku]??={sku,title:costs[sku]?.title??String(x.title??sku),qty:0,sales:0,expenses:0,payout:0,returns:0};
      map[sku].qty+=Number(x.quantity??1)||1;
      map[sku].sales+=sale;
      map[sku].expenses+=comm+log+store+pen+acq+accept+deduct;
      map[sku].payout+=pay;
      if(isReturn) map[sku].returns+=Math.abs(sale);
    }

    const skuEconomics=Object.values(map).map((x:any)=>{
      const cost=(costs[x.sku]?.cost||0)*x.qty;
      const profit=x.payout-cost;
      return {...x,sales:round(x.sales),expenses:round(x.expenses),payout:round(x.payout),returns:round(x.returns),costPrice:costs[x.sku]?.cost||0,profit:round(profit),margin:x.sales?round(profit/x.sales*100):0};
    }).sort((a:any,b:any)=>b.sales-a.sales);

    const totalExpenses=commission+logistics+storage+penalties+acquiring+acceptance+deductions;
    const burden=sales?Math.abs(totalExpenses)/Math.abs(sales)*100:0;
    const recommendations:any[]=[];
    if(burden>30) recommendations.push({level:"high",title:"Высокие расходы Wildberries",text:"Совокупные удержания составляют "+round(burden)+"% продаж. В первую очередь проверьте комиссию и логистику."});
    if(penalties) recommendations.push({level:"high",title:"Есть штрафы",text:"Штрафы за период: "+round(penalties)+" ₽."});
    if(returns>0 && sales) recommendations.push({level:"medium",title:"Контролируйте возвраты",text:"Возвраты составляют около "+round(Math.abs(returns/sales)*100)+"% от продаж по сумме."});
    for(const x of skuEconomics.filter((x:any)=>x.costPrice>0&&x.profit<0).slice(0,5)) recommendations.push({level:"high",title:"Убыточный SKU "+x.sku,text:"Расчётная прибыль "+x.profit+" ₽ при заданной себестоимости."});
    if(!skuEconomics.some((x:any)=>x.costPrice>0)) recommendations.push({level:"medium",title:"Заполните себестоимость",text:"Без себестоимости нельзя корректно оценить чистую прибыль по SKU."});

    const payload={ok:true,from,to,source:"finance-api-v1",partial:rows.length>=100000,summary:{sales:round(sales),commission:round(commission),logistics:round(logistics),storage:round(storage),penalties:round(penalties),acquiring:round(acquiring),acceptance:round(acceptance),deductions:round(deductions),returns:round(returns),payout:round(payout),takeRate:round(burden),operations:rows.length,skuEconomics,recommendations}};
    await saveCached(key,payload);
    return NextResponse.json(payload,{headers:{"Cache-Control":"no-store"}});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"WB_REQUEST_FAILED"},{status:502});
  }
}
