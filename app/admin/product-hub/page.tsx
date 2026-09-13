'use client';

import { useEffect,useState } from 'react';

type MP='wb'|'ozon';
type HubProduct={id:number;sku:string;title:string;description:string;dimensions:any;sourceMarketplace:string;updatedAt:string;links:any[]};

const labels:Record<string,string>={wb:'Wildberries',ozon:'Ozon'};

export default function ProductHubPage(){
  const [source,setSource]=useState<MP>('wb');
  const [target,setTarget]=useState<MP>('ozon');
  const [products,setProducts]=useState<HubProduct[]>([]);
  const [rules,setRules]=useState<any[]>([]);
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState('');

  const load=async()=>{
    const r=await fetch('/api/admin/product-hub',{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(r.status===401){location.href='/admin';return}
    if(!r.ok){setMsg(j.error||'Ошибка загрузки');return}
    setProducts(j.products||[]);setRules(j.rules||[]);
  };
  useEffect(()=>{load()},[]);

  const start=async()=>{
    if(source===target){setMsg('Источник и цель должны отличаться');return}
    setBusy(true);setMsg('Подтягиваю карточки и включаю автоперенос…');
    const r=await fetch('/api/admin/product-hub/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({marketplace:source,target,autoPublish:true})});
    const j=await r.json().catch(()=>({}));
    setMsg(r.ok?`✓ Загружено карточек: ${j.imported||0}. Автоперенос включён.`:(j.error||'Ошибка'));
    await load();setBusy(false);
  };

  const autoMap=async()=>{
    setBusy(true);setMsg('Автоматически разбираю несопоставленные карточки…');
    const r=await fetch('/api/admin/product-hub/auto-map',{method:'POST'});
    const j=await r.json().catch(()=>({}));
    setMsg(r.ok?`✓ Проверено: ${j.processed||0}. Автоматически сопоставлено: ${j.autoMapped||0}. Нужна проверка: ${j.manualReview||0}.`:(j.error||'Ошибка автосопоставления'));
    await load();setBusy(false);
  };

  const needsMapping=products.reduce((n,p)=>n+(p.links||[]).filter((l:any)=>['needs_mapping','manual_review'].includes(l.status)).length,0);

  return <main className="admin-shell">
    <div className="admin-top"><div><h1>Product Hub</h1><p>Автоперенос карточек между маркетплейсами по SKU</p></div><button className="edit-btn" onClick={load}>Обновить</button></div>

    <section className="admin-card editor">
      <h2>Автоматический перенос</h2>
      <p>Выбери источник и площадку назначения один раз. Дальше TechRoom будет подтягивать изменения во время штатной синхронизации.</p>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
        <select value={source} onChange={e=>setSource(e.target.value as MP)} style={{padding:11,borderRadius:10,border:'1px solid #ddd'}}><option value="wb">Wildberries</option><option value="ozon">Ozon</option></select>
        <span>→</span>
        <select value={target} onChange={e=>setTarget(e.target.value as MP)} style={{padding:11,borderRadius:10,border:'1px solid #ddd'}}><option value="ozon">Ozon</option><option value="wb">Wildberries</option></select>
        <button className="save-btn" disabled={busy} onClick={start}>{busy?'Работаю…':'Подтянуть и включить автоперенос'}</button>
        <button className="edit-btn" disabled={busy||needsMapping===0} onClick={autoMap}>Автосопоставить {needsMapping?`(${needsMapping})`:''}</button>
      </div>
      {msg&&<p><b>{msg}</b></p>}
      {rules.length>0&&<p>Активные правила: {rules.map((r:any)=>`${labels[r.source]||r.source} → ${labels[r.target]||r.target}`).join(', ')}</p>}
    </section>

    <section className="admin-card list-card">
      <div className="list-head"><div><h2>Эталонный каталог</h2><span>{products.length} карточек</span></div></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>SKU</th><th>Товар</th><th>Источник</th><th>Связи</th><th>Обновлено</th></tr></thead><tbody>
        {products.map(p=><tr key={p.id}><td><b>{p.sku}</b></td><td><b>{p.title||'Без названия'}</b><small style={{display:'block',maxWidth:420}}>{(p.description||'').slice(0,140)}</small></td><td>{labels[p.sourceMarketplace]||p.sourceMarketplace}</td><td>{(p.links||[]).map((l:any,i:number)=><div key={i}><b>{labels[l.marketplace]||l.marketplace}</b>: {l.status}{l.error?<small style={{display:'block'}}>{l.error}</small>:null}</div>)}</td><td><small>{p.updatedAt?new Date(p.updatedAt).toLocaleString('ru-RU'):'—'}</small></td></tr>)}
      </tbody></table></div>
    </section>

    <section className="admin-card editor"><h2>Как работает автоматизация</h2><p>Если одинаковый SKU уже есть на целевой площадке, TechRoom синхронизирует название, описание и габариты автоматически. Если карточки ещё нет, Smart Mapper пытается определить категорию по названию, описанию и характеристикам. Очевидные товары получают статус «auto_mapped», спорные — «manual_review» и не публикуются автоматически.</p></section>
  </main>;
}
