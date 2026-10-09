#!/usr/bin/env node
import pg from 'pg';
const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}});
const n=v=>Number(v?.amount??v??0)||0, r=v=>Math.round(v*100)/100;
const months=Array.from({length:12},(_,i)=>'2026-'+String(i+1).padStart(2,'0'));
const blank=()=>({sales:0,marketplaceNet:0,tax:0,cogs:0,variable:0,profit:0,records:0,units:0});
const out={generatedAt:new Date().toISOString(),year:2026,channels:{},months:{},warnings:[]};
try{
  const ps=await pool.query("SELECT sku,title,cost_price,tax_rate,variable_cost FROM price_sheet");
  const costs=new Map(ps.rows.map(x=>[String(x.sku),{cost:n(x.cost_price),tax:n(x.tax_rate)||7,variable:n(x.variable_cost)}]));
  const anyCost=ps.rows.some(x=>n(x.cost_price)>0);
  if(!anyCost)out.warnings.push('Себестоимость (cost_price) не заполнена ни по одному SKU; прибыль ниже рассчитана до себестоимости.');
  const defaultTax=7;

  const wbq=await pool.query("SELECT month,page,payload FROM marketplace_finance_pages WHERE source='wildberries' AND month BETWEEN '2026-01' AND '2026-12' ORDER BY month,page");
  const wbrq=await pool.query("SELECT month,page,payload FROM marketplace_finance_pages WHERE source='wildberries_reports' AND month BETWEEN '2026-01' AND '2026-12' ORDER BY month,page");
  const wbMonths=Object.fromEntries(months.map(m=>[m,blank()]));
  const seenWb=new Set();
  for(const q of wbq.rows)for(const x of(Array.isArray(q.payload)?q.payload:[])){
    const m=String(q.month),z=wbMonths[m]||blank();
    z.records++;
    const sale=n(x.retailAmount);
    z.sales+=sale;
    const code=String(x.vendorCode||x.sku||'');
    const qty=Math.abs(n(x.quantity))||0;
    const key=String(x.srid||x.orderUid||x.rrdId||'')+'|'+code+'|'+String(x.saleDt||'');
    if(qty&&sale>0&&!seenWb.has(key)){seenWb.add(key);z.units+=qty;const c=costs.get(code);if(c){z.cogs+=c.cost*qty;z.variable+=c.variable*qty;}}
    wbMonths[m]=z;
  }
  for(const q of wbrq.rows)for(const x of(Array.isArray(q.payload)?q.payload:[])){
    const m=String(q.month),z=wbMonths[m]||blank();
    z.marketplaceNet+=n(x.bankPaymentSum);
    wbMonths[m]=z;
  }
  for(const m of months){const z=wbMonths[m];z.tax=z.sales*defaultTax/100;z.profit=z.marketplaceNet-z.tax-z.cogs-z.variable;for(const k of Object.keys(z))z[k]=r(z[k]);}
  const wbTotal=blank();for(const m of months)for(const k of Object.keys(wbTotal))wbTotal[k]+=wbMonths[m][k]||0;for(const k of Object.keys(wbTotal))wbTotal[k]=r(wbTotal[k]);
  out.channels.wildberries={...wbTotal,profitLabel:anyCost?'после выплат WB, налога, себестоимости и переменных расходов':'после выплат WB и налога; без себестоимости',monthly:wbMonths};

  const ozq=await pool.query("SELECT month,page,payload FROM marketplace_finance_pages WHERE source='ozon' AND month BETWEEN '2026-01' AND '2026-12' ORDER BY month,page");
  const ozMonths=Object.fromEntries(months.map(m=>[m,blank()]));
  const unitsByMonth=Object.fromEntries(months.map(m=>[m,new Map()]));
  for(const q of ozq.rows)for(const a of(Array.isArray(q.payload)?q.payload:[])){
    const m=String(q.month),z=ozMonths[m]||blank();z.records++;z.marketplaceNet+=n(a.total_amount);
    for(const p of(a?.posting?.products??[])){
      const com=p?.commission||{};
      const gross=n(com.sale_amount||com.seller_price||com.sale_price);
      if(gross<=0)continue;
      const sku=String(p.sku||'');
      const key=String(a.unit_number||a.posting_number||a.accrual_id||'')+'|'+sku;
      const qty=n(p.quantity)||1;
      const old=unitsByMonth[m].get(key);
      if(!old||gross>old.gross)unitsByMonth[m].set(key,{sku,gross,qty});
    }
    ozMonths[m]=z;
  }
  for(const m of months){
    const z=ozMonths[m];
    for(const u of unitsByMonth[m].values()){z.sales+=u.gross;z.units+=u.qty;const c=costs.get(u.sku);if(c){z.cogs+=c.cost*u.qty;z.variable+=c.variable*u.qty;}}
    z.tax=z.sales*defaultTax/100;z.profit=z.marketplaceNet-z.tax-z.cogs-z.variable;
    for(const k of Object.keys(z))z[k]=r(z[k]);
  }
  const ozTotal=blank();for(const m of months)for(const k of Object.keys(ozTotal))ozTotal[k]+=ozMonths[m][k]||0;for(const k of Object.keys(ozTotal))ozTotal[k]=r(ozTotal[k]);
  out.channels.ozon={...ozTotal,profitLabel:anyCost?'после начислений Ozon, налога, себестоимости и переменных расходов':'после начислений Ozon и налога; без себестоимости',monthly:ozMonths};

  const site=await pool.query(`SELECT count(DISTINCT o.id)::int orders,coalesce(sum(DISTINCT o.total_amount),0)::numeric sales
    FROM orders o WHERE o.created_at>='2026-01-01' AND o.created_at<'2027-01-01' AND (o.payment_status='succeeded' OR o.paid_at IS NOT NULL)`);
  const siteSales=n(site.rows[0]?.sales),siteTax=siteSales*defaultTax/100;
  out.channels.site={orders:n(site.rows[0]?.orders),sales:r(siteSales),marketplaceNet:r(siteSales),tax:r(siteTax),cogs:0,variable:0,profit:r(siteSales-siteTax),profitLabel:'после налога; без себестоимости'};
  out.total={sales:r(wbTotal.sales+ozTotal.sales+siteSales),marketplaceNet:r(wbTotal.marketplaceNet+ozTotal.marketplaceNet+siteSales),tax:r(wbTotal.tax+ozTotal.tax+siteTax),cogs:r(wbTotal.cogs+ozTotal.cogs),variable:r(wbTotal.variable+ozTotal.variable),profit:r(wbTotal.profit+ozTotal.profit+siteSales-siteTax)};
  const compact={
  generatedAt:out.generatedAt,
  year:out.year,
  warning:out.warnings,
  wildberries:{
    sales:out.channels.wildberries.sales,
    marketplaceNet:out.channels.wildberries.marketplaceNet,
    tax:out.channels.wildberries.tax,
    cogs:out.channels.wildberries.cogs,
    profit:out.channels.wildberries.profit,
    monthly:Object.fromEntries(Object.entries(out.channels.wildberries.monthly).filter(([m,v])=>v.sales||v.marketplaceNet).map(([m,v])=>[m,{sales:v.sales,marketplaceNet:v.marketplaceNet,tax:v.tax,profit:v.profit}]))
  },
  ozon:{
    sales:out.channels.ozon.sales,
    marketplaceNet:out.channels.ozon.marketplaceNet,
    tax:out.channels.ozon.tax,
    cogs:out.channels.ozon.cogs,
    profit:out.channels.ozon.profit,
    monthly:Object.fromEntries(Object.entries(out.channels.ozon.monthly).filter(([m,v])=>v.sales||v.marketplaceNet).map(([m,v])=>[m,{sales:v.sales,marketplaceNet:v.marketplaceNet,tax:v.tax,profit:v.profit}]))
  },
  site:out.channels.site,
  total:out.total
};
console.log(JSON.stringify(compact));
}finally{await pool.end();}
