#!/usr/bin/env node
import pg from 'pg';
const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}});
const num=v=>Number(v)||0;
const round=v=>Math.round(v*100)/100;
const out={generatedAt:new Date().toISOString(),year:2026,channels:{},warnings:[],debug:{}};
try{
  const ps=await pool.query("SELECT sku,title,cost_price,tax_rate,variable_cost FROM price_sheet");
  const costs=new Map(ps.rows.map(r=>[String(r.sku),{title:r.title,cost:num(r.cost_price),tax:num(r.tax_rate),variable:num(r.variable_cost)}]));
  if(!ps.rows.some(r=>num(r.cost_price)>0))out.warnings.push('cost_price_not_filled');
  const wbq=await pool.query("SELECT month,payload FROM marketplace_finance_pages WHERE source='wildberries' AND month BETWEEN '2026-01' AND '2026-12' ORDER BY month,page");
  const wbr=wbq.rows.flatMap(r=>(Array.isArray(r.payload)?r.payload:[]).map(x=>({...x,_month:r.month})));
  out.debug.wbKeys=wbr[0]?Object.keys(wbr[0]).sort():[];
  out.debug.wbNumericSums={};
  for(const k of out.debug.wbKeys){let sum=0,seen=0;for(const x of wbr){if(typeof x[k]==='number'){sum+=x[k];seen++;}}if(seen)out.debug.wbNumericSums[k]={seen,sum:round(sum)};}
  let wbRetail=0,wbPayout=0,wbLogistics=0,wbStorage=0,wbPenalty=0,wbCogs=0,wbTax=0,wbVariable=0,wbQty=0;
  for(const x of wbr){
    const retail=num(x.retail_amount??x.retailAmount??x.retail_price_withdisc_rub);
    const payout=num(x.ppvz_for_pay??x.for_pay??x.payout);
    const logistics=num(x.delivery_rub??x.delivery_amount??x.logistics);
    const storage=num(x.storage_fee??x.storage_rub);
    const penalty=num(x.penalty??x.penalty_rub);
    wbRetail+=retail; wbPayout+=payout; wbLogistics+=logistics; wbStorage+=storage; wbPenalty+=penalty;
    const qty=Math.abs(num(x.quantity??1))||1; wbQty+=qty;
    const sku=String(x.sa_name??x.vendor_code??x.article??'');
    const c=costs.get(sku);
    if(c){wbCogs+=c.cost*qty;wbTax+=retail*c.tax/100;wbVariable+=c.variable*qty;}
  }
  out.channels.wildberries={records:wbr.length,quantity:round(wbQty),sales:round(wbRetail),marketplaceNet:round(wbPayout),logistics:round(wbLogistics),storage:round(wbStorage),penalties:round(wbPenalty),cogs:round(wbCogs),tax:round(wbTax),variable:round(wbVariable),profitEstimate:round(wbPayout-wbCogs-wbTax-wbVariable)};
  const ozq=await pool.query("SELECT month,payload FROM marketplace_finance_pages WHERE source='ozon' AND month BETWEEN '2026-01' AND '2026-12' ORDER BY month,page");
  const ozr=ozq.rows.flatMap(r=>(Array.isArray(r.payload)?r.payload:[]).map(x=>({...x,_month:r.month})));
  out.debug.ozKeys=ozr[0]?Object.keys(ozr[0]).sort():[];
  const op=ozr.find(x=>x?.posting)||ozr[0];
  out.debug.ozPostingKeys=op?.posting?Object.keys(op.posting).sort():[];
  const prod=op?.posting?.products?.[0];
  out.debug.ozProductKeys=prod?Object.keys(prod).sort():[];
  out.debug.ozSaleKeys=prod?.sale?Object.keys(prod.sale).sort():[];
  let ozTotal=0,ozSales=0,ozServices=0,ozCogs=0,ozTax=0,ozVariable=0,ozQty=0;
  for(const a of ozr){
    ozTotal+=num(a.total_amount?.amount??a.total_amount);
    for(const x of(a?.posting?.products??[])){
      const sale=num(x?.sale?.seller_price?.amount??x?.sale?.seller_price??x?.seller_price?.amount??x?.seller_price);
      const qty=num(x?.quantity)||1;ozQty+=qty;ozSales+=sale;
      let fees=num(x?.delivery?.total_accrued?.amount??x?.delivery?.total_accrued);
      for(const g of(x?.item_fees?.fees??[]))for(const f of(g?.fees??[]))fees+=num(f?.accrued?.amount??f?.accrued);
      ozServices+=fees;
      const sku=String(x.offer_id??x.sku??x.product_id??'');const c=costs.get(sku);
      if(c){ozCogs+=c.cost*qty;ozTax+=sale*c.tax/100;ozVariable+=c.variable*qty;}
    }
    ozServices+=num(a?.non_item_fee?.accrued?.amount??a?.non_item_fee?.accrued);
    for(const f of(a?.container_fees??[]))ozServices+=num(f?.accrued?.amount??f?.accrued??f?.total_amount?.amount??f?.total_amount);
  }
  out.channels.ozon={records:ozr.length,quantity:round(ozQty),netAccruals:round(ozTotal),sales:round(ozSales),services:round(ozServices),cogs:round(ozCogs),tax:round(ozTax),variable:round(ozVariable),profitEstimate:round(ozSales+ozServices-ozCogs-ozTax-ozVariable)};
  const site=await pool.query("SELECT count(*)::int orders,coalesce(sum(total_amount),0)::numeric sales FROM orders WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01' AND (payment_status='succeeded' OR paid_at IS NOT NULL)");
  out.channels.site={orders:num(site.rows[0]?.orders),sales:num(site.rows[0]?.sales),profitEstimate:null};
  out.totalEstimatedProfit=round(num(out.channels.wildberries.profitEstimate)+num(out.channels.ozon.profitEstimate));
  console.log(JSON.stringify(out));
}finally{await pool.end();}
