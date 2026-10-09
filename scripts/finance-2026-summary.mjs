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
  if(!ps.rows.some(r=>num(r.cost_price)>0))out.warnings.push('cost_price_not_filled_exact_profit_unavailable');
  const wbq=await pool.query("SELECT month,payload FROM marketplace_finance_pages WHERE source='wildberries' AND month BETWEEN '2026-01' AND '2026-12' ORDER BY month,page");
  const wbr=wbq.rows.flatMap(r=>(Array.isArray(r.payload)?r.payload:[]).map(x=>({...x,_month:r.month})));
  out.debug.wbKeys=wbr[0]?Object.keys(wbr[0]).sort():[];
  out.debug.wbNumericSums={};
  out.debug.wbMoneySums={};
  for(const k of out.debug.wbKeys){let sum=0,seen=0;for(const x of wbr){if(typeof x[k]==='number'){sum+=x[k];seen++;}}if(seen)out.debug.wbNumericSums[k]={seen,sum:round(sum)};}
  for(const k of ['retailAmount','forPay','deliveryAmount','paidStorage','paidAcceptance','paymentProcessing','acquiringFee','deduction','additionalPayment','penalty','returnAmount','ppvzReward','ppvzSalesCommission','cashbackAmount','cashbackCommissionChange']){let sum=0,seen=0;for(const x of wbr){const v=Number(x[k]);if(Number.isFinite(v)){sum+=v;seen++;}}out.debug.wbMoneySums[k]={seen,sum:round(sum)};}
  let wbRetail=0,wbForPay=0,wbLogistics=0,wbStorage=0,wbAcceptance=0,wbPenalty=0,wbDeduction=0,wbAdditional=0,wbAcquiring=0,wbCashbackAmount=0,wbCashbackDiscount=0,wbCashbackCommission=0,wbCogs=0,wbTax=0,wbVariable=0,wbQty=0;
  const wbMonthly={};
  for(const x of wbr){
    const retail=num(x.retailAmount??x.retail_amount??x.retail_price_withdisc_rub);
    const forPay=num(x.forPay??x.for_pay??x.ppvz_for_pay??x.payout);
    const logistics=num(x.deliveryService??x.delivery_rub??x.logistics);
    const storage=num(x.paidStorage??x.storage_fee??x.storage_rub);
    const acceptance=num(x.paidAcceptance??x.acceptance);
    const penalty=num(x.penalty??x.penalty_rub);
    const deduction=num(x.deduction);
    const additional=num(x.additionalPayment??x.additional_payment);
    const acquiring=num(x.acquiringFee??x.acquiring_fee);
    const cashbackAmount=num(x.cashbackAmount);
    const cashbackDiscount=num(x.cashbackDiscount);
    const cashbackCommission=num(x.cashbackCommissionChange);
    wbRetail+=retail; wbForPay+=forPay; wbLogistics+=logistics; wbStorage+=storage; wbAcceptance+=acceptance; wbPenalty+=penalty; wbDeduction+=deduction; wbAdditional+=additional; wbAcquiring+=acquiring; wbCashbackAmount+=cashbackAmount; wbCashbackDiscount+=cashbackDiscount; wbCashbackCommission+=cashbackCommission;
    const qty=Math.abs(num(x.quantity??1))||1; wbQty+=qty;
    const sku=String(x.vendorCode??x.sa_name??x.vendor_code??x.article??x.sku??'');
    const c=costs.get(sku);
    if(c){wbCogs+=c.cost*qty;wbVariable+=c.variable*qty;}
    wbTax+=retail*(c?.tax??7)/100;
    const date=String(x.saleDt??x.sale_dt??x.orderDt??x.order_dt??'').slice(0,7);
    const month=/^2026-(0[1-9]|1[0-2])$/.test(date)?date:'unknown';
    const m=wbMonthly[month]??(wbMonthly[month]={records:0,sales:0,forPay:0,logistics:0,storage:0,acceptance:0,penalties:0,deductions:0,additionalPayments:0,tax:0});
    m.records++;m.sales+=retail;m.forPay+=forPay;m.logistics+=logistics;m.storage+=storage;m.acceptance+=acceptance;m.penalties+=penalty;m.deductions+=deduction;m.additionalPayments+=additional;m.tax+=retail*(c?.tax??7)/100;
  }
  for(const m of Object.values(wbMonthly))for(const k of Object.keys(m))if(k!=='records')m[k]=round(m[k]);
  const wbNetBeforeCogs=wbForPay-wbLogistics-wbStorage-wbAcceptance-wbPenalty-wbDeduction+wbAdditional-wbCashbackAmount+wbCashbackDiscount-wbCashbackCommission;
  out.channels.wildberries={records:wbr.length,quantity:round(wbQty),sales:round(wbRetail),forPay:round(wbForPay),logistics:round(wbLogistics),storage:round(wbStorage),acceptance:round(wbAcceptance),penalties:round(wbPenalty),deductions:round(wbDeduction),additionalPayments:round(wbAdditional),acquiringFee:round(wbAcquiring),cashbackAmount:round(wbCashbackAmount),cashbackDiscount:round(wbCashbackDiscount),cashbackCommissionChange:round(wbCashbackCommission),netBeforeCogsAndTax:round(wbNetBeforeCogs),cogs:round(wbCogs),tax:round(wbTax),variable:round(wbVariable),profitEstimate:round(wbNetBeforeCogs-wbCogs-wbTax-wbVariable),monthly:wbMonthly};
  const ozq=await pool.query("SELECT month,payload FROM marketplace_finance_pages WHERE source='ozon' AND month BETWEEN '2026-01' AND '2026-12' ORDER BY month,page");
  const ozr=ozq.rows.flatMap(r=>(Array.isArray(r.payload)?r.payload:[]).map(x=>({...x,_month:r.month})));
  out.debug.ozKeys=ozr[0]?Object.keys(ozr[0]).sort():[];
  const op=ozr.find(x=>x?.posting)||ozr[0];
  out.debug.ozPostingKeys=op?.posting?Object.keys(op.posting).sort():[];
  const prod=op?.posting?.products?.[0];
  out.debug.ozProductKeys=prod?Object.keys(prod).sort():[];
  out.debug.ozSaleKeys=prod?.sale?Object.keys(prod.sale).sort():[];
  out.debug.ozCommissionKeys=prod?.commission?Object.keys(prod.commission).sort():[];
  out.debug.ozDeliveryKeys=prod?.delivery?Object.keys(prod.delivery).sort():[];
  out.debug.ozItemFeesKeys=ozr.find(x=>Array.isArray(x?.item_fees)&&x.item_fees.length)?.item_fees?.[0]?Object.keys(ozr.find(x=>Array.isArray(x?.item_fees)&&x.item_fees.length).item_fees[0]).sort():[];
  out.debug.ozNonItemFeeKeys=ozr.find(x=>x?.non_item_fee)?.non_item_fee?Object.keys(ozr.find(x=>x?.non_item_fee).non_item_fee).sort():[];
  out.debug.ozCategories={};
  for(const x of ozr){const k=String(x.accrued_category||'unknown');out.debug.ozCategories[k]??={count:0,total:0};out.debug.ozCategories[k].count++;out.debug.ozCategories[k].total+=num(x.total_amount?.amount??x.total_amount);}for(const k of Object.keys(out.debug.ozCategories))out.debug.ozCategories[k].total=round(out.debug.ozCategories[k].total);
  let ozTotal=0,ozSales=0,ozSaleCommission=0,ozDelivery=0,ozItemFees=0,ozNonItemFees=0,ozContainerFees=0,ozCogs=0,ozTax=0,ozVariable=0,ozQty=0;
  const ozMonthly={};
  for(const a of ozr){
    const total=num(a.total_amount?.amount??a.total_amount);
    ozTotal+=total;
    const date=String(a.date??'').slice(0,7);
    const month=/^2026-(0[1-9]|1[0-2])$/.test(date)?date:'unknown';
    const m=ozMonthly[month]??(ozMonthly[month]={records:0,netAccruals:0,sales:0,saleCommission:0,delivery:0,itemFees:0,nonItemFees:0,containerFees:0,tax:0});
    m.records++;m.netAccruals+=total;
    for(const x of(a?.posting?.products??[])){
      const sale=num(x?.commission?.seller_price?.amount??x?.commission?.seller_price);
      const saleCommission=num(x?.commission?.sale_commission?.amount??x?.commission?.sale_commission);
      const delivery=num(x?.delivery?.total_accrued?.amount??x?.delivery?.total_accrued);
      const qty=num(x?.quantity)||1;ozQty+=qty;ozSales+=sale;ozSaleCommission+=saleCommission;ozDelivery+=delivery;
      m.sales+=sale;m.saleCommission+=saleCommission;m.delivery+=delivery;
      let itemFees=0;
      for(const g of(x?.item_fees?.fees??[]))for(const f of(g?.fees??[]))itemFees+=num(f?.accrued?.amount??f?.accrued);
      ozItemFees+=itemFees;m.itemFees+=itemFees;
      const sku=String(x.sku??x.offer_id??x.product_id??'');const c=costs.get(sku);
      if(c){ozCogs+=c.cost*qty;ozVariable+=c.variable*qty;}
      ozTax+=sale*(c?.tax??7)/100;m.tax+=sale*(c?.tax??7)/100;
    }
    const nonItem=num(a?.non_item_fee?.accrued?.amount??a?.non_item_fee?.accrued);ozNonItemFees+=nonItem;m.nonItemFees+=nonItem;
    let container=0;for(const f of(a?.container_fees??[]))container+=num(f?.accrued?.amount??f?.accrued??f?.total_amount?.amount??f?.total_amount);
    ozContainerFees+=container;m.containerFees+=container;
  }
  for(const m of Object.values(ozMonthly))for(const k of Object.keys(m))if(k!=='records')m[k]=round(m[k]);
  out.channels.ozon={records:ozr.length,quantity:round(ozQty),netAccruals:round(ozTotal),sales:round(ozSales),saleCommission:round(ozSaleCommission),delivery:round(ozDelivery),itemFees:round(ozItemFees),nonItemFees:round(ozNonItemFees),containerFees:round(ozContainerFees),cogs:round(ozCogs),tax:round(ozTax),variable:round(ozVariable),profitEstimate:round(ozTotal-ozCogs-ozTax-ozVariable),monthly:ozMonthly};
  const site=await pool.query("SELECT count(*)::int orders,coalesce(sum(total_amount),0)::numeric sales FROM orders WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01' AND (payment_status='succeeded' OR paid_at IS NOT NULL)");
  out.channels.site={orders:num(site.rows[0]?.orders),sales:num(site.rows[0]?.sales),profitEstimate:null};
  out.totalEstimatedProfit=round(num(out.channels.wildberries.profitEstimate)+num(out.channels.ozon.profitEstimate));
  console.log(JSON.stringify(out));
}finally{await pool.end();}
