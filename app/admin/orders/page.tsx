'use client';

import { useEffect, useMemo, useState } from 'react';

type Order={
  id:string; source:'site'|'wildberries'|'ozon'; orderNumber:string; status:string; totalAmount:number;
  customerName?:string|null; phone?:string|null; email?:string|null; deliveryMethod?:string|null; address?:string|null;
  paymentMethod?:string|null; comment?:string|null; items:any[]; createdAt:string; syncedAt?:string|null;
};

const labels:Record<string,string>={new:'Новый',confirmed:'Подтверждён',shipped:'Отправлен',completed:'Завершён',cancelled:'Отменён'};
const sourceLabels:Record<string,string>={site:'TechRoom',wildberries:'Wildberries',ozon:'Ozon'};
const money=(n:number)=>new Intl.NumberFormat('ru-RU').format(n)+' ₽';

export default function OrdersPage(){
  const [orders,setOrders]=useState<Order[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [source,setSource]=useState('all');
  const [q,setQ]=useState('');
  const [busy,setBusy]=useState('');

  const load=async()=>{
    setLoading(true);setError('');
    const r=await fetch('/api/admin/orders',{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(r.status===401){setError('Нужно войти в админку');setLoading(false);return;}
    if(!r.ok){setError(j.error||'Не удалось загрузить заказы');setLoading(false);return;}
    setOrders(j.orders||[]);setLoading(false);
  };
  useEffect(()=>{load()},[]);

  const filtered=useMemo(()=>orders.filter(o=>{
    if(source!=='all'&&o.source!==source)return false;
    const hay=[o.orderNumber,o.customerName,o.phone,o.email,o.status,sourceLabels[o.source]].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q.toLowerCase());
  }),[orders,source,q]);

  const setStatus=async(order:Order,status:string)=>{
    if(order.source!=='site')return;
    setBusy(order.id);
    const r=await fetch('/api/admin/orders/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:order.id,status})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok) alert(j.error||'Не удалось изменить статус');
    await load();setBusy('');
  };

  return <main className="admin-shell">
    <div className="admin-top"><div><h1>Заказы</h1><p>TechRoom + Wildberries + Ozon в одном окне</p></div><button className="edit-btn" onClick={load}>Обновить</button></div>
    <section className="admin-card list-card">
      <div className="list-head" style={{alignItems:'center'}}>
        <div><h2>Все заказы</h2><span>{filtered.length} из {orders.length}</span></div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <select value={source} onChange={e=>setSource(e.target.value)} style={{border:'1px solid #ded4ca',borderRadius:10,padding:'11px 12px'}}>
            <option value="all">Все источники</option><option value="site">TechRoom</option><option value="wildberries">Wildberries</option><option value="ozon">Ozon</option>
          </select>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Номер, клиент, телефон"/>
        </div>
      </div>
      {loading&&<p>Загрузка…</p>}
      {error&&<p>{error} {error.includes('войти')&&<a href="/admin">Войти</a>}</p>}
      {!loading&&!error&&<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Источник</th><th>Заказ</th><th>Клиент</th><th>Товары</th><th>Сумма</th><th>Статус</th><th>Дата</th></tr></thead><tbody>
        {filtered.map(o=><tr key={`${o.source}-${o.id}`}>
          <td><b>{sourceLabels[o.source]}</b></td>
          <td><b>{o.orderNumber||'—'}</b>{o.source==='site'&&<small style={{display:'block'}}>#{o.id}</small>}</td>
          <td><div>{o.customerName||'—'}</div><small>{o.phone||''}{o.email?<><br/>{o.email}</>:null}</small>{o.address&&<small style={{display:'block',maxWidth:260}}>{o.address}</small>}</td>
          <td><details><summary>{o.items?.length||0} поз.</summary><div style={{minWidth:260,paddingTop:8}}>{(o.items||[]).map((x:any,i:number)=><div key={i} style={{marginBottom:7}}><b>{x.title||x.name||x.offerId||x.article||'Товар'}</b><br/><small>{x.sku||''} · {x.quantity||1} шт.{x.price!=null?` · ${money(Number(x.price))}`:''}</small></div>)}</div></details></td>
          <td><b>{money(o.totalAmount||0)}</b></td>
          <td>{o.source==='site'?<select disabled={busy===o.id} value={o.status} onChange={e=>setStatus(o,e.target.value)} style={{padding:'7px 8px',borderRadius:8,border:'1px solid #ddd'}}>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>:<span>{o.status}</span>}</td>
          <td><small>{new Date(o.createdAt).toLocaleString('ru-RU')}</small>{o.syncedAt&&<small style={{display:'block'}}>sync: {new Date(o.syncedAt).toLocaleString('ru-RU')}</small>}</td>
        </tr>)}
      </tbody></table></div>}
    </section>
  </main>;
}
