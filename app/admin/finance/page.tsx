'use client';
// cost-editor-deploy
import { useEffect,useMemo,useState } from 'react';

const rub=(n:number)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(Number(n)||0);
const pct=(n:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(Number(n)||0)+'%';
const monthName=(m:string)=>new Date(m+'-01T00:00:00Z').toLocaleDateString('ru-RU',{month:'short'}).replace('.','');
const labels:any={wildberries:'Wildberries',ozon:'Ozon',site:'Duisun.ru'};

export default function FinancePage(){
 const [year,setYear]=useState(new Date().getFullYear());
 const [data,setData]=useState<any>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
 const [costItems,setCostItems]=useState<any[]>([]); const [costBusy,setCostBusy]=useState(false); const [costStatus,setCostStatus]=useState('');
 const load=async()=>{setLoading(true);setError('');
   const [r,p]=await Promise.all([
     fetch('/api/admin/finance/dashboard?year='+year,{cache:'no-store'}),
     fetch('/api/admin/prices',{cache:'no-store'})
   ]);
   const j=await r.json().catch(()=>({})); const pj=await p.json().catch(()=>({}));
   if(r.status===401||p.status===401){location.href='/admin?next=/admin/finance';return}
   if(!r.ok){setError([j.error,j.detail].filter(Boolean).join(': ')||'Ошибка загрузки');setLoading(false);return}
   setData(j); if(p.ok)setCostItems(pj.items||[]); setLoading(false)
 };
 const patchCost=(sku:string,v:number)=>setCostItems(prev=>prev.map(x=>x.sku===sku?{...x,costPrice:v}:x));
 const saveCosts=async()=>{setCostBusy(true);setCostStatus('Сохраняю себестоимость…');
   const r=await fetch('/api/admin/prices',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:costItems.map(x=>({
     sku:x.sku,price:Number(x.price)||0,minPrice:Number(x.minPrice)||0,costPrice:Number(x.costPrice)||0,taxRate:Number(x.taxRate)||7,variableCost:Number(x.variableCost)||0,
     syncOzon:x.syncOzon,syncWb:x.syncWb,syncYandex:x.syncYandex,syncAvito:x.syncAvito,avitoItemId:x.avitoItemId
   }))})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok){setCostStatus(j.error||'Ошибка сохранения');setCostBusy(false);return}
   setCostItems(j.items||costItems);setCostStatus('✓ Себестоимость сохранена');setCostBusy(false);await load();
 };
 useEffect(()=>{load();const t=setInterval(load,300000);return()=>clearInterval(t)},[year]);
 const maxMonthly=useMemo(()=>Math.max(1,...(data?.monthly||[]).map((x:any)=>Math.abs(Number(x.total?.sales)||0))),[data]);
 if(loading&&!data)return <main className="admin-shell"><section className="admin-card finance-overview"><h1>Финансы</h1><p>Загрузка KPI и P&amp;L…</p></section></main>;
 return <main className="admin-shell">
   <div className="admin-top"><div><h1>Финансы · KPI &amp; P&amp;L</h1><p>Wildberries + Ozon + Duisun.ru · автоматическая сводка</p></div>
    <div className="finance-filter"><input type="number" min="2022" max="2100" value={year} onChange={e=>setYear(Number(e.target.value))}/><button onClick={load} disabled={loading}>{loading?'Обновление…':'Обновить'}</button></div></div>
   {error&&<section className="admin-card finance-error"><b>{error}</b><div>Попробуйте обновить страницу.</div></section>}
   {data&&<>
    {data.partial&&<section className="admin-card finance-error"><b>Часть источников рассчитана не полностью</b><div>{Object.keys(data.errors||{}).map(k=>k==='wildberries'?'Wildberries':k==='ozon'?'Ozon':k==='site'?'Duisun.ru':k).join(', ')}</div></section>}
    <section className="finance-kpis">
      <div className="finance-kpi"><span>Выручка</span><strong>{rub(data.total.sales)}</strong><small>Продажи по всем каналам</small></div>
      <div className="finance-kpi"><span>К выплате / net</span><strong>{rub(data.total.net)}</strong><small>После расчётов маркетплейсов</small></div>
      <div className="finance-kpi"><span>Прибыль</span><strong>{rub(data.total.profit)}</strong><small>{data.dataQuality.profitFinal?'После всех учтённых затрат':'До незаполненной себестоимости'}</small></div>
      <div className="finance-kpi"><span>Маржа</span><strong>{pct(data.total.margin)}</strong><small>Прибыль / выручка</small></div>
      <div className="finance-kpi"><span>Удержания площадок</span><strong>{rub(data.total.deductions)}</strong><small>Продажи − net с учётом корректировок</small></div>
      <div className="finance-kpi"><span>Налог</span><strong>{rub(data.total.tax)}</strong><small>Расчёт по ставке 7%</small></div>
      <div className="finance-kpi"><span>Средний чек</span><strong>{rub(data.total.avgCheck)}</strong><small>Выручка / проданные единицы</small></div>
      <div className="finance-kpi"><span>Себестоимость заполнена</span><strong>{pct(data.dataQuality.costCoverage)}</strong><small>{data.dataQuality.costFilled} из {data.dataQuality.costTotal} SKU</small></div>
    </section>

    <section className="admin-card finance-overview"><div className="finance-head"><h2>Валюта отчёта</h2><p>Все суммы приводятся к российским рублям</p></div>
      <div className="finance-flow">
        <div><span>Базовая валюта</span><b>{data.currency||'RUB'}</b></div>
        <div><span>Источник курсов</span><b>{data.fx?.source||'CBR'}</b></div>
        <div><span>Валюты в данных</span><b>{(data.fx?.currencies||['RUB']).join(', ')}</b></div>
        <div><span>Конвертировано операций</span><b>{data.fx?.convertedRecords||0}</b></div>
      </div>
      {data.fx?.approximateRates&&<p><small>Для части операций использован ближайший доступный курс; после backfill исторических курсов расчёт уточнится автоматически.</small></p>}
      {!!data.fx?.missingRates?.length&&<div className="finance-error"><b>Не хватает курсов</b><div>{data.fx.missingRates.slice(0,10).join(', ')}</div></div>}
    </section>

    {!data.dataQuality.profitFinal&&<section className="admin-card finance-error"><b>Прибыль пока предварительная</b><div>Не у всех SKU заполнена себестоимость. Заполни её ниже — P&amp;L пересчитается автоматически.</div></section>}

    <section className="admin-card finance-overview">
      <div className="finance-head">
        <div><h2>Себестоимость товаров</h2><p>Введите закупочную / производственную себестоимость за 1 шт. в рублях</p></div>
        <button className="save-btn" disabled={costBusy||!costItems.length} onClick={saveCosts}>{costBusy?'Сохраняю…':'Сохранить себестоимость'}</button>
      </div>
      {costStatus&&<p><b>{costStatus}</b></p>}
      <div className="admin-table-wrap"><table className="admin-table" style={{minWidth:760}}>
        <thead><tr><th>SKU</th><th>Товар</th><th>Себестоимость / шт.</th><th>Цена продажи</th><th>Статус</th></tr></thead>
        <tbody>{costItems.map((x:any)=><tr key={x.sku}>
          <td><b>{x.sku}</b></td>
          <td>{x.title||'Без названия'}</td>
          <td><input aria-label={'Себестоимость '+x.sku} type="number" min="0" step="1" value={x.costPrice??0} onChange={e=>patchCost(x.sku,Number(e.target.value))} style={{width:150,padding:'9px 10px',border:'1px solid #ded4ca',borderRadius:9}}/> ₽</td>
          <td>{rub(x.price||0)}</td>
          <td>{Number(x.costPrice)>0?'Заполнено':'Нужно заполнить'}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="admin-card finance-overview"><div className="finance-head"><h2>P&amp;L</h2><p>Управленческий отчёт за {year} год</p></div>
      <div className="admin-table-wrap"><table className="admin-table"><tbody>
       <tr><td><b>Выручка (Gross sales)</b></td><td style={{textAlign:'right'}}><b>{rub(data.pAndL.sales)}</b></td></tr>
       <tr><td>Удержания / комиссии / корректировки площадок</td><td style={{textAlign:'right'}}>- {rub(data.pAndL.marketplaceDeductions)}</td></tr>
       <tr><td><b>Поступления после площадок (Net)</b></td><td style={{textAlign:'right'}}><b>{rub(data.pAndL.net)}</b></td></tr>
       <tr><td>Налог 7%</td><td style={{textAlign:'right'}}>- {rub(data.pAndL.tax)}</td></tr>
       <tr><td>Себестоимость проданного товара (COGS)</td><td style={{textAlign:'right'}}>- {rub(data.pAndL.cogs)}</td></tr>
       <tr><td>Переменные расходы</td><td style={{textAlign:'right'}}>- {rub(data.pAndL.variable)}</td></tr>
       <tr><td style={{fontSize:16}}><b>Операционная прибыль</b></td><td style={{textAlign:'right',fontSize:18}}><b>{rub(data.pAndL.profit)}</b></td></tr>
      </tbody></table></div>
    </section>

    <section className="admin-card finance-overview"><div className="finance-head"><h2>Каналы продаж</h2><p>Сравнение эффективности каналов</p></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Канал</th><th>Продажи</th><th>Net</th><th>Налог</th><th>COGS</th><th>Прибыль</th><th>Маржа</th></tr></thead><tbody>
       {Object.entries(data.channels).map(([key,v]:any)=><tr key={key}><td><b>{labels[key]||key}</b></td><td>{rub(v.sales)}</td><td>{rub(v.net)}</td><td>{rub(v.tax)}</td><td>{rub(v.cogs)}</td><td><b>{rub(v.profit)}</b></td><td>{pct(v.sales?v.profit/v.sales*100:0)}</td></tr>)}
      </tbody></table></div>
    </section>

    <section className="admin-card finance-overview"><div className="finance-head"><h2>Динамика по месяцам</h2><p>Выручка и прибыль</p></div>
      <div className="finance-bars">{data.monthly.map((x:any)=><div className="finance-bar-row" key={x.month}>
       <div className="finance-bar-label"><b>{monthName(x.month)} {x.month.slice(0,4)}</b><small>Прибыль {rub(x.total.profit)}</small></div>
       <div className="finance-bar-track"><i style={{width:Math.max(0,Math.min(100,Math.abs(x.total.sales)/maxMonthly*100))+'%'}}/></div>
       <strong>{rub(x.total.sales)}</strong>
      </div>)}</div>
    </section>

    <section className="admin-card finance-overview"><div className="finance-head"><h2>Состояние данных</h2><p>Последняя синхронизация финансовых источников</p></div>
      <div className="finance-flow">{['wildberries','wildberries_reports','ozon'].map(k=><div key={k}><span>{k==='wildberries_reports'?'WB выплаты':labels[k]||k}</span><b>{data.updated?.[k]?new Date(data.updated[k]).toLocaleString('ru-RU'):'Нет данных'}</b></div>)}</div>
    </section>
   </>}
 </main>
}
