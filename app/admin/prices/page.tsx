'use client';

import { useEffect,useMemo,useState } from 'react';

type PriceRow={
  sku:string;productId:number|null;title:string;price:number;minPrice:number;costPrice:number;taxRate:number;variableCost:number;stock:number;
  syncOzon:boolean;syncWb:boolean;syncYandex:boolean;syncAvito:boolean;avitoItemId:number|null;updatedAt:string;
};

export default function PricesPage(){
  const [items,setItems]=useState<PriceRow[]>([]);
  const [marketplaces,setMarketplaces]=useState<any>({});
  const [q,setQ]=useState('');
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');

  const load=async()=>{
    const r=await fetch('/api/admin/prices',{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(r.status===401){location.href='/admin';return}
    if(!r.ok){setStatus(j.error||'Ошибка загрузки');return}
    setItems(j.items||[]);setMarketplaces(j.marketplaces||{});setStatus('');
  };
  useEffect(()=>{load()},[]);

  const filtered=useMemo(()=>{
    const s=q.trim().toLowerCase();
    return !s?items:items.filter(x=>(x.title+' '+x.sku).toLowerCase().includes(s));
  },[items,q]);

  const patch=(sku:string,data:Partial<PriceRow>)=>setItems(prev=>prev.map(x=>x.sku===sku?{...x,...data}:x));

  const save=async(syncAfter=false)=>{
    setBusy(true);setStatus('Сохраняю лист цен…');
    const r=await fetch('/api/admin/prices',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:items.map(x=>({
      sku:x.sku,price:Number(x.price)||0,minPrice:Number(x.minPrice)||0,costPrice:Number(x.costPrice)||0,taxRate:Number(x.taxRate)||0,variableCost:Number(x.variableCost)||0,syncOzon:x.syncOzon,syncWb:x.syncWb,syncYandex:x.syncYandex,syncAvito:x.syncAvito,avitoItemId:x.avitoItemId
    }))})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok){setStatus(j.error||'Ошибка сохранения');setBusy(false);return}
    setItems(j.items||items);
    setStatus('✓ Цены сохранены в TechRoom');
    if(syncAfter)await syncNow();
    else setBusy(false);
  };

  const syncNow=async()=>{
    setBusy(true);setStatus('Выгружаю цены на маркетплейсы…');
    const r=await fetch('/api/admin/prices',{method:'POST'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok){setStatus(j.error||'Ошибка выгрузки');setBusy(false);return}
    const res=j.result||{};
    const parts=[
      res.ozon?.prices&&typeof res.ozon.prices==='object'?'Ozon: '+(res.ozon.prices.updated??res.ozon.prices.requested??0):null,
      typeof res.wb?.prices==='number'?'WB: '+res.wb.prices:null,
      typeof res.yandex?.prices==='number'?'Яндекс: '+res.yandex.prices:null,
      res.avito?.prices&&typeof res.avito.prices==='object'?'Avito: '+(res.avito.prices.updated??0):null,
    ].filter(Boolean);
    setStatus('✓ Синхронизация завершена'+(parts.length?' · '+parts.join(' · '):''));
    setBusy(false);
  };

  const badge=(name:string,ok:boolean)=><span style={{display:'inline-flex',alignItems:'center',gap:6,padding:'6px 10px',borderRadius:999,background:ok?'#edf9f1':'#f1efed',color:ok?'#157a43':'#7b7168',fontSize:12,fontWeight:700}}>{ok?'●':'○'} {name}</span>;

  return <main className="admin-shell">
    <div className="admin-top">
      <div><h1>Лист цен</h1><p>Единая цена TechRoom → Ozon, Wildberries и Яндекс Маркет</p></div>
      <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
        <button className="edit-btn" disabled={busy} onClick={load}>Обновить</button>
        <button className="save-btn" disabled={busy||!items.length} onClick={()=>save(false)}>Сохранить</button>
        <button className="save-btn" disabled={busy||!items.length} onClick={()=>save(true)}>{busy?'Работаю…':'Сохранить и выгрузить'}</button>
      </div>
    </div>

    <section className="admin-card editor">
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
        {badge('Ozon',Boolean(marketplaces.ozon))}
        {badge('Wildberries',Boolean(marketplaces.wb))}
        {badge('Яндекс Маркет',Boolean(marketplaces.yandex))}
        {badge('Avito',Boolean(marketplaces.avito))}
      </div>
      <p style={{marginBottom:0,color:'#756c64'}}>Цена из этого листа является главной. Минимальная цена — нижний предел: ниже него выгрузка не уйдёт.</p>
      {status&&<p style={{marginBottom:0}}><b>{status}</b></p>}
    </section>

    <section className="admin-card list-card">
      <div className="list-head">
        <div><h2>Цены товаров</h2><span>{items.length} SKU</span></div>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Поиск по названию или SKU"/>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table" style={{minWidth:1250}}>
          <thead><tr><th>SKU</th><th>Товар</th><th>Цена TechRoom</th><th>Минимальная</th><th>Себестоимость</th><th>Налог, %</th><th>Переменные / шт.</th><th>Остаток</th><th>Ozon</th><th>WB</th><th>Яндекс</th><th>Avito</th><th>Avito ID</th><th>Обновлено</th></tr></thead>
          <tbody>
            {filtered.map(x=><tr key={x.sku}>
              <td><b>{x.sku}</b></td>
              <td><b>{x.title||'Без названия'}</b></td>
              <td><input aria-label={'Цена '+x.sku} type="number" min="0" value={x.price} onChange={e=>patch(x.sku,{price:Number(e.target.value)})} style={{width:120,padding:'9px 10px',border:'1px solid #ded4ca',borderRadius:9}}/> ₽</td>
              <td><input aria-label={'Минимальная цена '+x.sku} type="number" min="0" value={x.minPrice} onChange={e=>patch(x.sku,{minPrice:Number(e.target.value)})} style={{width:120,padding:'9px 10px',border:'1px solid #ded4ca',borderRadius:9}}/> ₽</td>\n              <td><input aria-label={'Себестоимость '+x.sku} type="number" min="0" value={x.costPrice} onChange={e=>patch(x.sku,{costPrice:Number(e.target.value)})} style={{width:120,padding:'9px 10px',border:'1px solid #ded4ca',borderRadius:9}}/> ₽</td>
              <td><input aria-label={'Налог '+x.sku} type="number" min="0" max="100" step="0.1" value={x.taxRate} onChange={e=>patch(x.sku,{taxRate:Number(e.target.value)})} style={{width:90,padding:'9px 10px',border:'1px solid #ded4ca',borderRadius:9}}/> %</td>
              <td><input aria-label={'Переменные расходы '+x.sku} type="number" min="0" value={x.variableCost} onChange={e=>patch(x.sku,{variableCost:Number(e.target.value)})} style={{width:120,padding:'9px 10px',border:'1px solid #ded4ca',borderRadius:9}}/> ₽</td>
              <td>{x.stock}</td>
              <td><input type="checkbox" checked={x.syncOzon} disabled={!marketplaces.ozon} onChange={e=>patch(x.sku,{syncOzon:e.target.checked})}/></td>
              <td><input type="checkbox" checked={x.syncWb} disabled={!marketplaces.wb} onChange={e=>patch(x.sku,{syncWb:e.target.checked})}/></td>
              <td><input type="checkbox" checked={x.syncYandex} disabled={!marketplaces.yandex} onChange={e=>patch(x.sku,{syncYandex:e.target.checked})}/></td>
              <td><input type="checkbox" checked={x.syncAvito} disabled={!marketplaces.avito} onChange={e=>patch(x.sku,{syncAvito:e.target.checked})}/></td>
              <td><input type="number" min="1" value={x.avitoItemId||''} onChange={e=>patch(x.sku,{avitoItemId:e.target.value?Number(e.target.value):null})} placeholder="авто" style={{width:110,padding:'8px',border:'1px solid #ded4ca',borderRadius:9}}/></td>
              <td><small>{x.updatedAt?new Date(x.updatedAt).toLocaleString('ru-RU'):'—'}</small></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
