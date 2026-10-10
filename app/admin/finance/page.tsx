'use client';
import { useEffect,useMemo,useState } from 'react';

const rub=(n:number)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(Number(n)||0);
const pct=(n:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(Number(n)||0)+'%';
const monthName=(m:string,short=true)=>new Date(m+'-01T00:00:00Z').toLocaleDateString('ru-RU',{month:short?'short':'long'}).replace('.','');
const labels:any={all:'Сводка',wildberries:'Wildberries',ozon:'Ozon',avito:'Avito',site:'Duisun.ru'};
const empty=()=>({sales:0,net:0,tax:0,cogs:0,variable:0,profit:0,records:0,units:0});

export default function FinancePage(){
 const [year,setYear]=useState(new Date().getFullYear());
 const [channel,setChannel]=useState<'all'|'wildberries'|'ozon'|'avito'|'site'>('all');
 const [month,setMonth]=useState('all');
 const [data,setData]=useState<any>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [costItems,setCostItems]=useState<any[]>([]);
 const [costBusy,setCostBusy]=useState(false);
 const [costStatus,setCostStatus]=useState('');
 const [avitoBusy,setAvitoBusy]=useState(false);
 const [avitoStatus,setAvitoStatus]=useState('');
 const [avitoText,setAvitoText]=useState('');

 const load=async()=>{
   setLoading(true);setError('');
   const [r,p]=await Promise.all([
     fetch('/api/admin/finance/dashboard?year='+year,{cache:'no-store'}),
     fetch('/api/admin/prices',{cache:'no-store'})
   ]);
   const j=await r.json().catch(()=>({})); const pj=await p.json().catch(()=>({}));
   if(r.status===401||p.status===401){location.href='/admin?next=/admin/finance';return}
   if(!r.ok){setError([j.error,j.detail].filter(Boolean).join(': ')||'Ошибка загрузки');setLoading(false);return}
   setData(j); if(p.ok)setCostItems(pj.items||[]); setLoading(false);
 };

 const patchCost=(sku:string,v:number)=>setCostItems(prev=>prev.map(x=>x.sku===sku?{...x,costPrice:v}:x));
 const saveCosts=async()=>{
   setCostBusy(true);setCostStatus('Сохраняю себестоимость…');
   const r=await fetch('/api/admin/prices',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:costItems.map(x=>({
     sku:x.sku,price:Number(x.price)||0,minPrice:Number(x.minPrice)||0,costPrice:Number(x.costPrice)||0,taxRate:Number(x.taxRate)||7,variableCost:Number(x.variableCost)||0,
     syncOzon:x.syncOzon,syncWb:x.syncWb,syncYandex:x.syncYandex,syncAvito:x.syncAvito,avitoItemId:x.avitoItemId
   }))})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok){setCostStatus(j.error||'Ошибка сохранения');setCostBusy(false);return}
   setCostItems(j.items||costItems);setCostStatus('✓ Себестоимость сохранена');setCostBusy(false);await load();
 };

 const importAvito=async(file?:File)=>{
   setAvitoBusy(true);setAvitoStatus('Импортирую данные Avito…');
   const fd=new FormData();
   if(file)fd.append('file',file);
   if(!file&&avitoText.trim())fd.append('text',avitoText);
   const r=await fetch('/api/admin/finance/avito-import',{method:'POST',body:fd});
   const j=await r.json().catch(()=>({}));
   if(!r.ok){setAvitoStatus(j.error||'Ошибка импорта Avito');setAvitoBusy(false);return}
   setAvitoStatus('✓ Импортировано: '+(j.valid||0)+' строк · '+(j.months||[]).join(', '));
   setAvitoText('');
   setAvitoBusy(false);
   await load();
 };

 useEffect(()=>{load();const t=setInterval(load,300000);return()=>clearInterval(t)},[year]);

 const selected=useMemo(()=>{
   if(!data)return empty();
   let v:any;
   if(month==='all') v=channel==='all'?data.total:data.channels?.[channel];
   else{
     const row=(data.monthly||[]).find((x:any)=>x.month===month);
     v=channel==='all'?row?.total:row?.[channel];
   }
   const z={...empty(),...(v||{})};
   z.deductions=Number(z.sales||0)-Number(z.net||0);
   z.margin=z.sales?Number(z.profit||0)/Number(z.sales)*100:0;
   z.avgCheck=z.units?Number(z.sales||0)/Number(z.units):0;
   return z;
 },[data,channel,month]);

 const visibleMonthly=useMemo(()=>{
   if(!data)return[];
   const rows=month==='all'?(data.monthly||[]):(data.monthly||[]).filter((x:any)=>x.month===month);
   return rows.map((x:any)=>({month:x.month,value:channel==='all'?x.total:x[channel]}));
 },[data,channel,month]);

 const maxMonthly=useMemo(()=>Math.max(1,...visibleMonthly.map((x:any)=>Math.abs(Number(x.value?.sales)||0))),[visibleMonthly]);
 const scopeTitle=month==='all'?year+' год':monthName(month,false)+' '+year;

 if(loading&&!data)return <main className="admin-shell"><section className="admin-card finance-overview"><h1>Финансы</h1><p>Загрузка KPI и P&amp;L…</p></section></main>;

 return <main className="admin-shell">
   <div className="admin-top">
     <div><h1>Финансы · KPI &amp; P&amp;L</h1><p>{labels[channel]} · {scopeTitle} · все суммы в RUB</p></div>
     <div className="finance-filter">
       <input type="number" min="2022" max="2100" value={year} onChange={e=>{setYear(Number(e.target.value));setMonth('all')}}/>
       <button onClick={load} disabled={loading}>{loading?'Обновление…':'Обновить'}</button>
     </div>
   </div>

   <section className="admin-card finance-overview">
     <div className="finance-head"><h2>Вкладки по каналам</h2><p>Сводка, Wildberries, Ozon и Duisun.ru</p></div>
     <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
       {(['all','wildberries','ozon','avito','site'] as const).map(k=><button key={k} type="button" onClick={()=>{setChannel(k);setMonth('all')}}
         style={{padding:'10px 16px',borderRadius:10,border:channel===k?'2px solid #231f1b':'1px solid #ded4ca',background:channel===k?'#231f1b':'#fff',color:channel===k?'#fff':'#231f1b',fontWeight:700,cursor:'pointer'}}>
         {labels[k]}
       </button>)}
     </div>
   </section>

   <section className="admin-card finance-overview">
     <div className="finance-head"><h2>Вкладки по месяцам</h2><p>Годовой итог или отдельный месяц</p></div>
     <div style={{display:'flex',gap:7,flexWrap:'wrap'}}>
       <button type="button" onClick={()=>setMonth('all')}
         style={{padding:'8px 13px',borderRadius:9,border:month==='all'?'2px solid #231f1b':'1px solid #ded4ca',background:month==='all'?'#f1ece5':'#fff',fontWeight:700}}>Год</button>
       {(data?.months||[]).map((m:string)=><button key={m} type="button" onClick={()=>setMonth(m)}
         style={{padding:'8px 12px',borderRadius:9,border:month===m?'2px solid #231f1b':'1px solid #ded4ca',background:month===m?'#f1ece5':'#fff',fontWeight:month===m?700:500}}>
         {monthName(m)}
       </button>)}
     </div>
   </section>

   {error&&<section className="admin-card finance-error"><b>{error}</b><div>Попробуйте обновить страницу.</div></section>}
   {data&&<>
    {data.partial&&<section className="admin-card finance-error"><b>Часть источников рассчитана не полностью</b><div>{Object.keys(data.errors||{}).map(k=>labels[k]||k).join(', ')}</div></section>}

    {channel==='avito'&&<section className="admin-card finance-overview">
      <div className="finance-head"><h2>Импорт Avito без API</h2><p>CSV/JSON из личного кабинета или данные, собранные браузером</p></div>
      <div style={{display:'grid',gap:12}}>
        <label style={{display:'inline-flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <span style={{fontWeight:700}}>Файл CSV / JSON</span>
          <input type="file" accept=".csv,.txt,.json,text/csv,application/json" disabled={avitoBusy}
            onChange={e=>{const file=e.target.files?.[0];if(file)importAvito(file);e.currentTarget.value=''}}/>
        </label>
        <textarea value={avitoText} onChange={e=>setAvitoText(e.target.value)} rows={7}
          placeholder={'Или вставьте CSV / JSON из истории заказов Avito\nДата заказа;Номер заказа;Товар;Сумма;К выплате;Валюта;Статус'}
          style={{width:'100%',padding:12,border:'1px solid #ded4ca',borderRadius:10,fontFamily:'inherit'}}/>
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <button className="save-btn" disabled={avitoBusy||!avitoText.trim()} onClick={()=>importAvito()}>{avitoBusy?'Импорт…':'Импортировать Avito'}</button>
          <small style={{color:'#756c64'}}>Повторный импорт безопасен: дубли удаляются по отпечатку операции.</small>
        </div>
        {avitoStatus&&<p style={{margin:0}}><b>{avitoStatus}</b></p>}
      </div>
    </section>}

    <section className="finance-kpis">
      <div className="finance-kpi"><span>Выручка</span><strong>{rub(selected.sales)}</strong><small>{labels[channel]} · {scopeTitle}</small></div>
      <div className="finance-kpi"><span>К выплате / net</span><strong>{rub(selected.net)}</strong><small>После удержаний и корректировок</small></div>
      <div className="finance-kpi"><span>Прибыль</span><strong>{rub(selected.profit)}</strong><small>{data.dataQuality.profitFinal?'После учтённых затрат':'Предварительно, не вся себестоимость заполнена'}</small></div>
      <div className="finance-kpi"><span>Маржа</span><strong>{pct(selected.margin)}</strong><small>Прибыль / выручка</small></div>
      <div className="finance-kpi"><span>Удержания</span><strong>{rub(selected.deductions)}</strong><small>Выручка − net</small></div>
      <div className="finance-kpi"><span>Налог</span><strong>{rub(selected.tax)}</strong><small>По учтённой ставке</small></div>
      <div className="finance-kpi"><span>Продано единиц</span><strong>{Number(selected.units||0).toLocaleString('ru-RU')}</strong><small>{selected.records||0} финансовых записей</small></div>
      <div className="finance-kpi"><span>Средний чек</span><strong>{rub(selected.avgCheck)}</strong><small>Выручка / единицы</small></div>
    </section>

    <section className="admin-card finance-overview"><div className="finance-head"><h2>P&amp;L · {labels[channel]}</h2><p>{scopeTitle}</p></div>
      <div className="admin-table-wrap"><table className="admin-table"><tbody>
       <tr><td><b>Выручка (Gross sales)</b></td><td style={{textAlign:'right'}}><b>{rub(selected.sales)}</b></td></tr>
       <tr><td>Удержания / комиссии / корректировки</td><td style={{textAlign:'right'}}>- {rub(selected.deductions)}</td></tr>
       <tr><td><b>Поступления после площадки (Net)</b></td><td style={{textAlign:'right'}}><b>{rub(selected.net)}</b></td></tr>
       <tr><td>Налог</td><td style={{textAlign:'right'}}>- {rub(selected.tax)}</td></tr>
       <tr><td>Себестоимость проданного товара (COGS)</td><td style={{textAlign:'right'}}>- {rub(selected.cogs)}</td></tr>
       <tr><td>Переменные расходы</td><td style={{textAlign:'right'}}>- {rub(selected.variable)}</td></tr>
       <tr><td style={{fontSize:16}}><b>Операционная прибыль</b></td><td style={{textAlign:'right',fontSize:18}}><b>{rub(selected.profit)}</b></td></tr>
      </tbody></table></div>
    </section>

    <section className="admin-card finance-overview"><div className="finance-head"><h2>По месяцам · {labels[channel]}</h2><p>Выручка, net, себестоимость и прибыль</p></div>
      <div className="admin-table-wrap"><table className="admin-table">
        <thead><tr><th>Месяц</th><th>Выручка</th><th>Net</th><th>Удержания</th><th>Налог</th><th>COGS</th><th>Переменные</th><th>Прибыль</th><th>Маржа</th></tr></thead>
        <tbody>{visibleMonthly.map((x:any)=>{
          const v=x.value||empty(); const deductions=Number(v.sales||0)-Number(v.net||0); const margin=v.sales?Number(v.profit||0)/Number(v.sales)*100:0;
          return <tr key={x.month}><td><b>{monthName(x.month,false)} {x.month.slice(0,4)}</b></td><td>{rub(v.sales)}</td><td>{rub(v.net)}</td><td>{rub(deductions)}</td><td>{rub(v.tax)}</td><td>{rub(v.cogs)}</td><td>{rub(v.variable)}</td><td><b>{rub(v.profit)}</b></td><td>{pct(margin)}</td></tr>
        })}</tbody>
      </table></div>
    </section>

    <section className="admin-card finance-overview"><div className="finance-head"><h2>Динамика · {labels[channel]}</h2><p>Выручка и прибыль по месяцам</p></div>
      <div className="finance-bars">{visibleMonthly.map((x:any)=><div className="finance-bar-row" key={x.month}>
       <div className="finance-bar-label"><b>{monthName(x.month)} {x.month.slice(0,4)}</b><small>Прибыль {rub(x.value?.profit)}</small></div>
       <div className="finance-bar-track"><i style={{width:Math.max(0,Math.min(100,Math.abs(Number(x.value?.sales)||0)/maxMonthly*100))+'%'}}/></div>
       <strong>{rub(x.value?.sales)}</strong>
      </div>)}</div>
    </section>

    {channel==='all'&&<section className="admin-card finance-overview"><div className="finance-head"><h2>Сравнение каналов</h2><p>{scopeTitle}</p></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Канал</th><th>Продажи</th><th>Net</th><th>Налог</th><th>COGS</th><th>Прибыль</th><th>Маржа</th></tr></thead><tbody>
       {(['wildberries','ozon','avito','site'] as const).map(key=>{
         const v=month==='all'?data.channels[key]:(data.monthly.find((x:any)=>x.month===month)?.[key]||empty());
         return <tr key={key}><td><b>{labels[key]}</b></td><td>{rub(v.sales)}</td><td>{rub(v.net)}</td><td>{rub(v.tax)}</td><td>{rub(v.cogs)}</td><td><b>{rub(v.profit)}</b></td><td>{pct(v.sales?v.profit/v.sales*100:0)}</td></tr>
       })}
      </tbody></table></div>
    </section>}

    <section className="admin-card finance-overview"><div className="finance-head"><h2>Валюта отчёта</h2><p>Все суммы приводятся к российским рублям</p></div>
      <div className="finance-flow">
        <div><span>Базовая валюта</span><b>{data.currency||'RUB'}</b></div>
        <div><span>Источник курсов</span><b>{data.fx?.source||'CBR'}</b></div>
        <div><span>Валюты в данных</span><b>{(data.fx?.currencies||['RUB']).join(', ')}</b></div>
        <div><span>Конвертировано операций</span><b>{data.fx?.convertedRecords||0}</b></div>
      </div>
      {!!data.fx?.missingRates?.length&&<div className="finance-error"><b>Не хватает курсов</b><div>{data.fx.missingRates.slice(0,10).join(', ')}</div></div>}
    </section>

    {!data.dataQuality.profitFinal&&<section className="admin-card finance-error"><b>Прибыль пока предварительная</b><div>Не у всех SKU заполнена себестоимость. Заполни её ниже — P&amp;L пересчитается автоматически.</div></section>}

    <section className="admin-card finance-overview">
      <div className="finance-head"><div><h2>Себестоимость товаров</h2><p>Закупочная / производственная себестоимость за 1 шт. в рублях</p></div>
        <button className="save-btn" disabled={costBusy||!costItems.length} onClick={saveCosts}>{costBusy?'Сохраняю…':'Сохранить себестоимость'}</button></div>
      {costStatus&&<p><b>{costStatus}</b></p>}
      <div className="admin-table-wrap"><table className="admin-table" style={{minWidth:760}}>
        <thead><tr><th>SKU</th><th>Товар</th><th>Себестоимость / шт.</th><th>Цена продажи</th><th>Статус</th></tr></thead>
        <tbody>{costItems.map((x:any)=><tr key={x.sku}><td><b>{x.sku}</b></td><td>{x.title||'Без названия'}</td>
          <td><input aria-label={'Себестоимость '+x.sku} type="number" min="0" step="1" value={x.costPrice??0} onChange={e=>patchCost(x.sku,Number(e.target.value))} style={{width:150,padding:'9px 10px',border:'1px solid #ded4ca',borderRadius:9}}/> ₽</td>
          <td>{rub(x.price||0)}</td><td>{Number(x.costPrice)>0?'Заполнено':'Нужно заполнить'}</td></tr>)}</tbody>
      </table></div>
    </section>

    <section className="admin-card finance-overview"><div className="finance-head"><h2>Состояние данных</h2><p>Последняя синхронизация финансовых источников</p></div>
      <div className="finance-flow">{['wildberries','wildberries_reports','ozon','avito'].map(k=><div key={k}><span>{k==='wildberries_reports'?'WB выплаты':labels[k]||k}</span><b>{data.updated?.[k]?new Date(data.updated[k]).toLocaleString('ru-RU'):'Нет данных'}</b></div>)}</div>
    </section>
   </>}
 </main>
}
