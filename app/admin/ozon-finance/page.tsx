'use client';

import { useEffect,useMemo,useState } from 'react';

type SkuRow={
  sku:string;title:string;qty:number;sales:number;fees:number;net:number;
  costPrice:number;taxRate:number;variableCost:number;cogs:number;tax:number;
  variableExpenses:number;profit:number;margin:number;ozonCostShare:number;
};
type FinanceSummary={
  transactionCount:number;netTransactionAmount:number;accrualsForSale:number;services:number;ozonPoints:number;
  totalPositive:number;totalExpenses:number;totalCogs:number;totalTax:number;totalVariable:number;totalProfit:number;takeRate:number;
  byType:Array<{type:string;count:number;amount:number}>;
  skuEconomics:SkuRow[];
  recommendations:Array<{level:string;title:string;text:string}>;
};
type FinanceResponse={ok:boolean;from:string;to:string;summary?:FinanceSummary;error?:string};

const money=(v:number)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(v||0);
const dateInput=(d:Date)=>d.toISOString().slice(0,10);
const operationName=(type:string)=>({POSTING:'Заказы',ITEM:'Товары',NON_ITEM:'Услуги и прочие начисления'} as Record<string,string>)[type]??type;

export default function OzonFinanceDashboard(){
  const now=new Date();
  const [from,setFrom]=useState(dateInput(new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1))));
  const [to,setTo]=useState(dateInput(now));
  const [data,setData]=useState<FinanceResponse|null>(null);
  const [loading,setLoading]=useState(false);

  async function load(){
    setLoading(true);
    try{
      const start=new Date(from+'T00:00:00.000Z').toISOString();
      const end=new Date(to+'T23:59:59.999Z').toISOString();
      const r=await fetch('/api/admin/ozon/finance?from='+encodeURIComponent(start)+'&to='+encodeURIComponent(end),{cache:'no-store'});
      const j=await r.json();
      if(r.status===401){location.href='/admin?next=/admin/ozon-finance';return;}
      setData(j);
    }catch(e){setData({ok:false,from,to,error:e instanceof Error?e.message:'Ошибка загрузки'});}
    finally{setLoading(false);}
  }
  useEffect(()=>{load();},[]);

  const rows=useMemo(()=>data?.summary?.byType??[],[data]);
  const positive=rows.filter(x=>x.amount>0).reduce((s,x)=>s+x.amount,0);
  const negative=rows.filter(x=>x.amount<0).reduce((s,x)=>s+x.amount,0);
  const max=Math.max(1,...rows.slice(0,12).map(x=>Math.abs(x.amount)));
  const s=data?.summary;

  return <main className="admin-shell">
    <div className="admin-top">
      <div><a className="back" href="/admin/marketplaces">← Маркетплейсы</a><h1>Ozon · Финансы</h1><p>Финансовый результат и юнит-экономика с себестоимостью, налогом и переменными расходами</p></div>
      <div className="finance-filter"><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/><span>—</span><input type="date" value={to} onChange={e=>setTo(e.target.value)}/><button onClick={load} disabled={loading}>{loading?'Загрузка…':'Обновить'}</button></div>
    </div>

    {data&&!data.ok&&<div className="admin-card finance-error"><b>Не удалось получить данные Ozon</b><div>{data.error}</div></div>}

    <section className="finance-kpis">
      <div className="finance-kpi"><span>Продажи</span><strong>{money(s?.accrualsForSale??0)}</strong></div>
      <div className="finance-kpi"><span>Расходы Ozon</span><strong>{money(s?.services??0)}</strong></div>
      <div className="finance-kpi"><span>Себестоимость</span><strong>{money(s?.totalCogs??0)}</strong></div>
      <div className="finance-kpi"><span>Налоги</span><strong>{money(s?.totalTax??0)}</strong></div>
      <div className="finance-kpi"><span>Переменные расходы</span><strong>{money(s?.totalVariable??0)}</strong></div>
      <div className="finance-kpi"><span>Чистый вклад</span><strong>{money(s?.totalProfit??0)}</strong><small>после Ozon, себестоимости, налогов и переменных</small></div>
      <div className="finance-kpi"><span>Баллы Ozon / скидки</span><strong>{money(s?.ozonPoints??0)}</strong></div>
      <div className="finance-kpi"><span>Доля расходов Ozon</span><strong>{(s?.takeRate??0).toFixed(1)}%</strong></div>
    </section>

    <section className="admin-card finance-overview">
      <div className="finance-head"><div><h2>Юнит-экономика по SKU</h2><p>Фактический результат по каждому товару</p></div></div>
      <div className="admin-table-wrap"><table className="admin-table" style={{minWidth:1500}}><thead><tr>
        <th>SKU</th><th>Товар</th><th>Шт.</th><th>Продажи</th><th>Расходы Ozon</th><th>Себест./шт.</th><th>Себестоимость</th><th>Налог</th><th>Переменные</th><th>Прибыль</th><th>Маржа</th>
      </tr></thead><tbody>{(s?.skuEconomics??[]).map(x=><tr key={x.sku}>
        <td><b>{x.sku}</b></td><td>{x.title}</td><td>{x.qty}</td><td>{money(x.sales)}</td><td>{money(x.fees)}</td><td>{money(x.costPrice)}</td><td>{money(x.cogs)}</td><td>{money(x.tax)} <small>({x.taxRate}%)</small></td><td>{money(x.variableExpenses)} <small>({money(x.variableCost)}/шт.)</small></td><td><b>{money(x.profit)}</b></td><td>{x.margin}%</td>
      </tr>)}</tbody></table></div>
    </section>

    <section className="admin-card finance-overview">
      <div className="finance-head"><div><h2>Рекомендации</h2><p>Автоматический контроль убыточности и расходов</p></div></div>
      <div className="finance-recommendations">{(s?.recommendations??[]).map((r,i)=><div className={'finance-rec '+r.level} key={i}><b>{r.title}</b><p>{r.text}</p></div>)}</div>
    </section>

    <section className="admin-card finance-overview">
      <div className="finance-head"><div><h2>Денежный поток Ozon</h2><p>Начисления и удержания маркетплейса до внутренних расходов бизнеса</p></div></div>
      <div className="finance-flow"><div><span>Начисления</span><b>{money(positive)}</b></div><div><span>Удержания</span><b>{money(negative)}</b></div><div><span>Баланс</span><b>{money(positive+negative)}</b></div></div>
    </section>

    <section className="admin-card finance-overview">
      <div className="finance-head"><div><h2>Операции Ozon</h2><p>Крупнейшие статьи по абсолютной сумме</p></div></div>
      <div className="finance-bars">{rows.slice(0,12).map((r,i)=><div className="finance-bar-row" key={r.type+i}><div className="finance-bar-label"><b>{operationName(r.type)}</b><small>{r.count} операций</small></div><div className="finance-bar-track"><i style={{width:(Math.abs(r.amount)/max*100)+'%'}}/></div><strong>{money(r.amount)}</strong></div>)}</div>
    </section>
  </main>;
}
