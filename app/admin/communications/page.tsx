'use client';
import { useEffect,useMemo,useState } from 'react';

type Marketplace='wildberries'|'ozon';
type Kind='reviews'|'questions';
type Item={id:string;marketplace:Marketplace;type:Kind;text:string;rating:number|null;productName:string;sku:string;article:string;createdAt:string;answer?:any};

export default function CommunicationsPage(){
  const [marketplace,setMarketplace]=useState<Marketplace>('wildberries');
  const [kind,setKind]=useState<Kind>('reviews');
  const [items,setItems]=useState<Item[]>([]);
  const [loading,setLoading]=useState(false);
  const [status,setStatus]=useState('');
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [sending,setSending]=useState('');
  const [q,setQ]=useState('');

  const load=async()=>{
    setLoading(true);setStatus('Загрузка…');
    try{
      const r=await fetch(`/api/admin/communications/list?marketplace=${marketplace}&type=${kind}`,{cache:'no-store'});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){setItems([]);setStatus(r.status===401?'Сначала войдите в админку':`Ошибка: ${j.error||r.status}`);return;}
      setItems(j.items||[]);setStatus(`Найдено: ${(j.items||[]).length}`);
    }finally{setLoading(false)}
  };

  useEffect(()=>{load()},[marketplace,kind]);

  const filtered=useMemo(()=>items.filter(x=>(`${x.text} ${x.productName} ${x.sku} ${x.article}`).toLowerCase().includes(q.toLowerCase())),[items,q]);

  const send=async(item:Item)=>{
    const text=(drafts[item.id]||'').trim();
    if(text.length<2){setStatus('Введите ответ');return;}
    setSending(item.id);setStatus('Отправляем ответ…');
    try{
      const r=await fetch('/api/admin/communications/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({marketplace:item.marketplace,type:item.type,id:item.id,text,sku:item.sku})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){setStatus(`Ошибка: ${j.error||r.status}`);return;}
      setStatus('✓ Ответ отправлен');
      setDrafts(d=>({...d,[item.id]:''}));
      await load();
    }finally{setSending('')}
  };

  return <main className="admin-shell">
    <div className="admin-top"><div><h1>Отзывы и вопросы</h1><p>Ответы покупателям Wildberries и Ozon через API</p></div><button className="edit-btn" onClick={load} disabled={loading}>{loading?'Обновление…':'Обновить'}</button></div>

    <section className="admin-card editor">
      <div className="filters" style={{marginBottom:12}}>
        <button className={marketplace==='wildberries'?'sel':''} onClick={()=>setMarketplace('wildberries')}>Wildberries</button>
        <button className={marketplace==='ozon'?'sel':''} onClick={()=>setMarketplace('ozon')}>Ozon</button>
        <button className={kind==='reviews'?'sel':''} onClick={()=>setKind('reviews')}>Отзывы</button>
        <button className={kind==='questions'?'sel':''} onClick={()=>setKind('questions')}>Вопросы</button>
      </div>
      <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Поиск по тексту, товару, SKU" style={{flex:'1 1 280px',border:'1px solid #ded4ca',borderRadius:10,padding:'11px 12px'}}/>
        <span>{status}</span>
      </div>
    </section>

    {!filtered.length&&!loading?<section className="admin-card editor"><p>Нет необработанных обращений или API не вернул данные.</p></section>:null}

    {filtered.map(item=><section className="admin-card editor" key={`${item.marketplace}-${item.type}-${item.id}`}>
      <div className="editor-head"><div><h2>{item.productName||'Товар'}</h2><span>{item.marketplace==='wildberries'?'Wildberries':'Ozon'} · {item.type==='reviews'?'Отзыв':'Вопрос'} · ID {item.id}</span></div>{item.rating? <b>★ {item.rating}</b>:null}</div>
      <div style={{display:'grid',gap:8,marginBottom:14}}>
        {item.sku&&<div><b>SKU:</b> {item.sku}</div>}
        {item.article&&<div><b>Артикул:</b> {item.article}</div>}
        {item.createdAt&&<div><b>Дата:</b> {new Date(item.createdAt).toLocaleString('ru-RU')}</div>}
      </div>
      <div style={{background:'#faf7f3',border:'1px solid #eee4d9',borderRadius:12,padding:14,whiteSpace:'pre-wrap',lineHeight:1.5,marginBottom:14}}>{item.text||'Без текста'}</div>
      <label style={{display:'grid',gap:7,fontWeight:700,fontSize:13}}>Ответ
        <textarea rows={4} maxLength={item.marketplace==='ozon'&&item.type==='questions'?3000:5000} value={drafts[item.id]||''} onChange={e=>setDrafts(d=>({...d,[item.id]:e.target.value}))} placeholder="Введите ответ покупателю" style={{border:'1px solid #ded4ca',borderRadius:10,padding:12,font:'inherit'}}/>
      </label>
      <div className="editor-actions"><button className="save-btn" disabled={sending===item.id} onClick={()=>send(item)}>{sending===item.id?'Отправка…':'Отправить ответ'}</button></div>
    </section>)}
  </main>;
}
