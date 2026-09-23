'use client';

import { useEffect, useMemo, useState } from 'react';

type FinanceSummary = {
  transactionCount:number;
  netTransactionAmount:number;
  accrualsForSale:number;
  services:number;
  byType:Array<{type:string;count:number;amount:number}>;
  ozonPoints:number;
  skuEconomics:Array<{sku:string;title:string;qty:number;sales:number;fees:number;net:number;techroomPrice:number|null}>;
  breakdown:Array<{type:string;count:number;amount:number}>;
  totalPositive:number; totalExpenses:number; takeRate:number;
  recommendations:Array<{level:string;title:string;text:string}>;
};
type FinanceResponse = {ok:boolean;from:string;to:string;summary?:FinanceSummary;error?:string};

const money=(v:number)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(v||0);
const ozonOperationName=(type:string)=>{
  const names:Record<string,string>={
    POSTING:'Заказы',
    ITEM:'Товары',
    NON_ITEM:'Услуги и прочие начисления'
  };
  return names[type]??type;
};
const dateInput=(d:Date)=>d.toISOString().slice(0,10);

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
      const j=await r.json(); if(r.status===401){location.href='/admin?next=/admin/ozon-finance';return;} setData(j);
    }catch(e){setData({ok:false,from,to,error:e instanceof Error?e.message:'Ошибка загрузки'});}
    finally{setLoading(false);}
  }
  useEffect(()=>{load();},[]);

  const rows=useMemo(()=>data?.summary?.byType??[],[data]);
  const breakdown=useMemo(()=>data?.summary?.breakdown??[],[data]);
  const negative=rows.filter(x=>x.amount<0).reduce((s,x)=>s+x.amount,0);
  const positive=rows.filter(x=>x.amount>0).reduce((s,x)=>s+x.amount,0);
  const max=Math.max(1,...rows.slice(0,12).map(x=>Math.abs(x.amount)));

  return <main className="admin-shell">
    <div className="admin-top">
      <div><a className="back" href="/admin/marketplaces">← Маркетплейсы</a><h1>Ozon · Финансы</h1><p>Фактические начисления и удержания по данным Seller API</p></div>
      <div className="finance-filter"><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/><span>—</span><input type="date" value={to} onChange={e=>setTo(e.target.value)}/><button onClick={load} disabled={loading}>{loading?'Загрузка…':'Обновить'}</button></div>
    </div>

    {data && !data.ok && <div className="admin-card finance-error"><b>Не удалось получить данные Ozon</b><div>{data.error}</div></div>}

    <section className="finance-kpis">
      <div className="finance-kpi"><span>Итог операций</span><strong>{money(data?.summary?.netTransactionAmount??0)}</strong><small>после начислений и удержаний Ozon</small></div>
      <div className="finance-kpi"><span>Начислено за продажи</span><strong>{money(data?.summary?.accrualsForSale??0)}</strong><small>accruals_for_sale</small></div>
      <div className="finance-kpi"><span>Услуги Ozon</span><strong>{money(data?.summary?.services??0)}</strong><small>логистика и сервисные операции</small></div>
      <div className="finance-kpi"><span>Баллы Ozon / скидки</span><strong>{money(data?.summary?.ozonPoints??0)}</strong><small>операции, связанные с баллами и скидками</small></div>
      <div className="finance-kpi"><span>Операций</span><strong>{data?.summary?.transactionCount??0}</strong><small>за выбранный период</small></div>
    </section>

    <section className="admin-card finance-overview">
      <div className="finance-head"><div><h2>Денежный поток</h2><p>Положительные и отрицательные операции</p></div></div>
      <div className="finance-flow"><div><span>Начисления</span><b>{money(positive)}</b></div><div><span>Удержания</span><b>{money(negative)}</b></div><div><span>Баланс</span><b>{money(positive+negative)}</b></div></div>
    </section>

    <section className="admin-card finance-overview">
      <div className="finance-head"><div><h2>Операции по типам</h2><p>Крупнейшие статьи по абсолютной сумме</p></div></div>
      <div className="finance-bars">{rows.slice(0,12).map((r,i)=><div className="finance-bar-row" key={r.type+i}><div className="finance-bar-label"><b>{ozonOperationName(r.type)}</b><small>{r.count} операций</small></div><div className="finance-bar-track"><i style={{width:(Math.abs(r.amount)/max*100)+'%'}}/></div><strong>{money(r.amount)}</strong></div>)}</div>
      {!loading && rows.length===0 && data?.ok && <div className="empty">За выбранный период финансовых операций нет.</div>}
    </section>

    <section className="admin-card finance-overview">
      <div className="finance-head"><div><h2>Детализация</h2><p>Все категории финансовых транзакций Ozon</p></div></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Тип операции</th><th>Количество</th><th>Сумма</th><th>Доля от оборота операций</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.type+i}><td><b>{ozonOperationName(r.type)}</b></td><td>{r.count}</td><td>{money(r.amount)}</td><td>{positive?((Math.abs(r.amount)/positive)*100).toFixed(1):'0.0'}%</td></tr>)}</tbody></table></div>
    </section>
  </main>;
}
