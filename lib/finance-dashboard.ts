import { ensurePriceSheetSchema } from './price-sheet';
import { getPool } from './db';

const num=(v:any)=>Number(v?.amount??v??0)||0;
const round=(v:number)=>Math.round(v*100)/100;
const blank=()=>({sales:0,net:0,tax:0,cogs:0,variable:0,profit:0,records:0,units:0});

export async function financeDashboard(year:number){
  await ensurePriceSheetSchema();
  const pool=getPool();
  const months=Array.from({length:12},(_,i)=>year+'-'+String(i+1).padStart(2,'0'));
  const ps=await pool.query('SELECT sku,cost_price,tax_rate,variable_cost FROM price_sheet');
  const costs=new Map<string,{cost:number;tax:number;variable:number}>(ps.rows.map((x:any)=>[String(x.sku),{cost:num(x.cost_price),tax:num(x.tax_rate)||7,variable:num(x.variable_cost)}]));
  const costFilled=ps.rows.filter((x:any)=>num(x.cost_price)>0).length;
  const defaultTax=7;

  const bySource:any={wildberries:Object.fromEntries(months.map(m=>[m,blank()])),ozon:Object.fromEntries(months.map(m=>[m,blank()])),site:Object.fromEntries(months.map(m=>[m,blank()]))};

  const wb=await pool.query("SELECT month,payload FROM marketplace_finance_pages WHERE source='wildberries' AND month LIKE $1 ORDER BY month,page",[year+'-%']);
  const wbReports=await pool.query("SELECT month,payload FROM marketplace_finance_pages WHERE source='wildberries_reports' AND month LIKE $1 ORDER BY month,page",[year+'-%']);
  const seenWb=new Set<string>();
  for(const q of wb.rows) for(const x of (Array.isArray(q.payload)?q.payload:[])){
    const z=bySource.wildberries[String(q.month)]||blank(); z.records++;
    const sale=num(x.retailAmount); z.sales+=sale;
    const sku=String(x.vendorCode||x.sku||''); const qty=Math.abs(num(x.quantity));
    const key=String(x.srid||x.orderUid||x.rrdId||'')+'|'+sku+'|'+String(x.saleDt||'');
    if(qty&&sale>0&&!seenWb.has(key)){seenWb.add(key);z.units+=qty;const c=costs.get(sku);if(c){z.cogs+=c.cost*qty;z.variable+=c.variable*qty;}}
  }
  for(const q of wbReports.rows) for(const x of (Array.isArray(q.payload)?q.payload:[])) bySource.wildberries[String(q.month)].net+=num(x.bankPaymentSum);

  const oz=await pool.query("SELECT month,payload FROM marketplace_finance_pages WHERE source='ozon' AND month LIKE $1 ORDER BY month,page",[year+'-%']);
  const seenOzon:Record<string,Map<string,{sku:string;gross:number;qty:number}>>=Object.fromEntries(months.map(m=>[m,new Map()]));
  for(const q of oz.rows) for(const a of (Array.isArray(q.payload)?q.payload:[])){
    const m=String(q.month),z=bySource.ozon[m]||blank(); z.records++; z.net+=num(a.total_amount);
    for(const p of (a?.posting?.products??[])){
      const com=p?.commission||{}; const gross=num(com.sale_amount||com.seller_price||com.sale_price); if(gross<=0)continue;
      const sku=String(p.sku||''); const qty=num(p.quantity)||1; const key=String(a.unit_number||a.posting_number||a.accrual_id||'')+'|'+sku;
      const old=seenOzon[m].get(key); if(!old||gross>old.gross)seenOzon[m].set(key,{sku,gross,qty});
    }
  }
  for(const m of months) for(const u of seenOzon[m].values()){const z=bySource.ozon[m];z.sales+=u.gross;z.units+=u.qty;const c=costs.get(u.sku);if(c){z.cogs+=c.cost*u.qty;z.variable+=c.variable*u.qty;}}

  const site=await pool.query(`SELECT to_char(created_at,'YYYY-MM') month,COUNT(*)::int orders,COALESCE(SUM(total_amount),0)::numeric sales
    FROM orders WHERE created_at >= $1::date AND created_at < ($1::date+interval '1 year')
    AND (payment_status='succeeded' OR paid_at IS NOT NULL) GROUP BY 1`,[year+'-01-01']);
  for(const x of site.rows){const z=bySource.site[String(x.month)];if(z){z.sales=num(x.sales);z.net=z.sales;z.records=num(x.orders);z.units=num(x.orders);}}

  for(const source of Object.keys(bySource)) for(const m of months){
    const z=bySource[source][m]; z.tax=z.sales*defaultTax/100; z.profit=z.net-z.tax-z.cogs-z.variable;
    for(const k of Object.keys(z)) z[k]=round(z[k]);
  }
  const channelTotal=(source:string)=>{const t=blank();for(const m of months)for(const k of Object.keys(t))t[k]+=bySource[source][m][k]||0;for(const k of Object.keys(t))t[k]=round(t[k]);return t};
  const channels={wildberries:channelTotal('wildberries'),ozon:channelTotal('ozon'),site:channelTotal('site')};
  const total=blank();for(const s of Object.values(channels) as any[])for(const k of Object.keys(total))total[k]+=s[k]||0;for(const k of Object.keys(total))total[k]=round(total[k]);
  const deductions=round(total.sales-total.net);
  const margin=total.sales?round(total.profit/total.sales*100):0;
  const avgCheck=total.units?round(total.sales/total.units):0;
  const last=await pool.query("SELECT source,MAX(fetched_at) updated_at FROM marketplace_finance_pages GROUP BY source");
  return {
    year,generatedAt:new Date().toISOString(),months,monthly:months.map(m=>({month:m,wildberries:bySource.wildberries[m],ozon:bySource.ozon[m],site:bySource.site[m],
      total:Object.keys(blank()).reduce((a:any,k)=>{a[k]=round(bySource.wildberries[m][k]+bySource.ozon[m][k]+bySource.site[m][k]);return a;},{})})),
    channels,total:{...total,deductions,margin,avgCheck},
    pAndL:{sales:total.sales,marketplaceDeductions:deductions,net:total.net,tax:total.tax,cogs:total.cogs,variable:total.variable,profit:total.profit},
    dataQuality:{costFilled,costTotal:ps.rows.length,costCoverage:ps.rows.length?round(costFilled/ps.rows.length*100):0,profitFinal:costFilled===ps.rows.length&&ps.rows.length>0},
    updated:Object.fromEntries(last.rows.map((x:any)=>[x.source,x.updated_at]))
  };
}
