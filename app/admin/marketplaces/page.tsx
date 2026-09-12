'use client';
import { useEffect, useState } from 'react';

type MP='wb'|'ozon';
type Review={id:string;text:string;rating:number|null;productName?:string;sku?:string|number|null;userName?:string;createdAt?:string};
type Product={id:string;offerId?:string|null;title:string;description:string;sku?:string|number|null};

export default function MarketplacesPage(){
  const [mp,setMp]=useState<MP>('wb');
  const [tab,setTab]=useState<'reviews'|'products'|'settings'>('reviews');
  const [status,setStatus]=useState<any>(null);
  const [reviews,setReviews]=useState<Review[]>([]);
  const [products,setProducts]=useState<Product[]>([]);
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState('');
  const [msg,setMsg]=useState('');
  const [q,setQ]=useState('');
  const marketplaceName=mp==='wb'?'wildberries':'ozon';

  const loadStatus=async()=>{const r=await fetch('/api/admin/marketplaces/status',{cache:'no-store'});if(r.status===401){location.href='/admin';return}setStatus(await r.json())};
  const loadReviews=async()=>{setBusy('reviews');setMsg('');const r=await fetch(`/api/admin/communications/list?marketplace=${marketplaceName}&type=reviews`,{cache:'no-store'});const j=await r.json();if(!r.ok)setMsg(j.error||'Ошибка');else setReviews(j.items||[]);setBusy('')};
  const loadProducts=async()=>{setBusy('products');setMsg('');const r=await fetch(`/api/admin/marketplaces/products?marketplace=${mp}&limit=50&q=${encodeURIComponent(q)}`,{cache:'no-store'});const j=await r.json();if(!r.ok)setMsg(j.error||'Ошибка');else setProducts(Array.isArray(j)?j:[]);setBusy('')};
  useEffect(()=>{loadStatus()},[]);
  useEffect(()=>{if(tab==='reviews')loadReviews();if(tab==='products')loadProducts()},[mp,tab]);

  const makeDraft=async(r:Review)=>{setBusy('draft:'+r.id);const res=await fetch('/api/admin/marketplaces/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({marketplace:mp,rating:Number(r.rating||0),reviewText:r.text,productName:r.productName})});const j=await res.json();if(res.ok)setDrafts(d=>({...d,[r.id]:j.text}));else setMsg(j.error||'Ошибка AI');setBusy('')};
  const send=async(r:Review)=>{const text=(drafts[r.id]||'').trim();if(!text){setMsg('Сначала создайте или введите ответ');return}if(!confirm('Отправить этот ответ покупателю?'))return;setBusy('send:'+r.id);const res=await fetch('/api/admin/communications/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({marketplace:marketplaceName,type:'reviews',id:r.id,text,sku:r.sku})});const j=await res.json();if(res.ok){setMsg('✓ Ответ отправлен');await loadReviews()}else setMsg(j.error||'Ошибка отправки');setBusy('')};
  const saveProduct=async(p:Product)=>{if(!confirm(`Обновить карточку «${p.title}»?`))return;setBusy('product:'+p.id);const res=await fetch('/api/admin/marketplaces/product',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({marketplace:mp,id:p.id,offerId:p.offerId,title:mp==='wb'?p.title:undefined,description:p.description})});const j=await res.json();if(res.ok)setMsg('✓ Изменения отправлены на маркетплейс');else setMsg(j.error||'Ошибка обновления');setBusy('')};
  const configured=status?.[mp]?.configured;
  const btn=(active:boolean)=>({border:0,borderRadius:10,padding:'10px 14px',fontWeight:700,background:active?'#ff6b00':'#fff',color:active?'#fff':'#3a342f'} as any);

  return <main className="admin-shell">
    <div className="admin-top"><div><h1>Маркетплейсы</h1><p>Wildberries + Ozon · отзывы, AI-ответы и карточки товаров</p></div><div style={{display:'flex',gap:8}}><button style={btn(mp==='wb')} onClick={()=>setMp('wb')}>Wildberries</button><button style={btn(mp==='ozon')} onClick={()=>setMp('ozon')}>Ozon</button></div></div>
    <div className="admin-card editor" style={{display:'flex',gap:8,flexWrap:'wrap'}}><button style={btn(tab==='reviews')} onClick={()=>setTab('reviews')}>Отзывы</button><button style={btn(tab==='products')} onClick={()=>setTab('products')}>Карточки товаров</button><button style={btn(tab==='settings')} onClick={()=>setTab('settings')}>Подключение</button></div>
    {msg&&<div className="admin-card editor"><b>{msg}</b></div>}
    {!configured&&tab!=='settings'&&<div className="admin-card editor"><h2>API ещё не подключён</h2><p>Добавьте ключи в Environment на Render. В GitHub и браузер ключи не передаются.</p><button className="save-btn" onClick={()=>setTab('settings')}>Показать настройки</button></div>}

    {configured&&tab==='reviews'&&<section>
      <div className="admin-card editor" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><b>Необработанные отзывы</b><button className="edit-btn" onClick={loadReviews}>{busy==='reviews'?'Загрузка…':'Обновить'}</button></div>
      {reviews.length===0&&!busy?<div className="admin-card editor">Новых отзывов нет.</div>:reviews.map(r=><article className="admin-card editor" key={r.id}>
        <div className="editor-head"><div><h2 style={{fontSize:18}}>{r.productName||'Товар'}</h2><span>{'★'.repeat(Math.max(0,Math.min(5,Number(r.rating||0))))}{'☆'.repeat(Math.max(0,5-Number(r.rating||0)))}</span></div><small>{r.createdAt?new Date(r.createdAt).toLocaleDateString('ru-RU'):''}</small></div>
        <p style={{whiteSpace:'pre-wrap'}}>{r.text||'Отзыв без текста'}</p>
        <textarea style={{width:'100%',minHeight:110,border:'1px solid #ded4ca',borderRadius:10,padding:12}} value={drafts[r.id]||''} onChange={e=>setDrafts(d=>({...d,[r.id]:e.target.value}))} placeholder="Ответ продавца…" maxLength={5000}/>
        <div className="editor-actions"><button className="edit-btn" disabled={busy!==''} onClick={()=>makeDraft(r)}>{busy==='draft:'+r.id?'Генерирую…':'✨ AI-ответ'}</button><button className="save-btn" disabled={busy!==''||!(drafts[r.id]||'').trim()} onClick={()=>send(r)}>{busy==='send:'+r.id?'Отправляю…':'Отправить ответ'}</button></div>
      </article>)}
    </section>}

    {configured&&tab==='products'&&<section>
      <div className="admin-card editor" style={{display:'flex',gap:10}}><input style={{flex:1,border:'1px solid #ded4ca',borderRadius:10,padding:11}} value={q} onChange={e=>setQ(e.target.value)} placeholder="Артикул / ID товара"/><button className="edit-btn" onClick={loadProducts}>{busy==='products'?'Загрузка…':'Найти / обновить'}</button></div>
      {products.map((p,i)=><article className="admin-card editor" key={`${p.id}-${i}`}><div className="editor-head"><div><h2 style={{fontSize:18}}>{p.title||p.offerId}</h2><span>ID: {p.id}{p.offerId?` · Offer: ${p.offerId}`:''}</span></div></div><div className="form-grid">{mp==='wb'&&<label className="wide">Название<input value={p.title} maxLength={200} onChange={e=>setProducts(a=>a.map((x,idx)=>idx===i?{...x,title:e.target.value}:x))}/></label>}<label className="wide">Описание<textarea style={{minHeight:180}} value={p.description||''} maxLength={10000} onChange={e=>setProducts(a=>a.map((x,idx)=>idx===i?{...x,description:e.target.value}:x))}/></label></div><div className="editor-actions"><button className="save-btn" disabled={busy!==''} onClick={()=>saveProduct(p)}>{busy==='product:'+p.id?'Сохраняю…':'Сохранить на маркетплейсе'}</button></div></article>)}
    </section>}

    {tab==='settings'&&<section className="admin-card editor"><h2>Подключение API</h2><p>WB: <b>{status?.wb?.configured?'✓ подключён':'не подключён'}</b> · Ozon: <b>{status?.ozon?.configured?'✓ подключён':'не подключён'}</b> · AI: <b>{status?.ai?.configured?'✓ OpenAI':'шаблонные ответы'}</b></p><div style={{display:'grid',gap:8,background:'#2c241d',color:'#fff',padding:16,borderRadius:12}}><code>WB_API_TOKEN=...</code><code>OZON_CLIENT_ID=...</code><code>OZON_API_KEY=...</code><code>OPENAI_API_KEY=...</code><code>OPENAI_MODEL=gpt-5.6-luna</code><code>OZON_DESCRIPTION_ATTRIBUTE_ID=...</code></div><p>Для Ozon ID атрибута описания зависит от категории товара. Без него редактирование описания Ozon намеренно заблокировано.</p><button className="edit-btn" onClick={loadStatus}>Проверить настройки</button></section>}
  </main>;
}
