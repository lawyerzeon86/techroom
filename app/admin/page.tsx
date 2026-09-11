'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Product } from '../../lib/products';

const blank: Omit<Product,'id'> = {category:'Автозапчасти',title:'',price:0,oldPrice:null,rating:5,reviews:0,badge:'',emoji:'📦',imageUrl:'',imageUrls:[],sku:'',oem:'',stock:0,description:'',specs:'',isActive:true,sortOrder:0};
const categories = ['Автозапчасти','Электроника','Гаджеты','3D-печать'];

export default function AdminPage(){
 const [uploading,setUploading]=useState(false); const [authenticated,setAuthenticated]=useState<boolean|null>(null); const [password,setPassword]=useState(''); const [products,setProducts]=useState<Product[]>([]); const [selected,setSelected]=useState<Product|null>(null); const [draft,setDraft]=useState<any>(blank); const [q,setQ]=useState(''); const [status,setStatus]=useState(''); const [busy,setBusy]=useState(false);
 const load=async()=>{setStatus('Загрузка…'); const r=await fetch('/api/products?includeInactive=1',{cache:'no-store'}); if(r.status===401){setAuthenticated(false);setStatus('');return;} const j=await r.json(); if(!r.ok){setStatus(j.error||'Ошибка загрузки');return;} setProducts(j); setStatus('');};
 useEffect(()=>{fetch('/api/admin/session',{cache:'no-store'}).then(r=>r.json()).then(j=>{setAuthenticated(Boolean(j.authenticated)); if(j.authenticated) load();}).catch(()=>setAuthenticated(false))},[]);
 const login=async()=>{setBusy(true);setStatus('Проверяю…');const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});const j=await r.json();if(!r.ok){setStatus(j.error||'Ошибка входа');setBusy(false);return;}setPassword('');setAuthenticated(true);setStatus('');await load();setBusy(false)};
 const logout=async()=>{await fetch('/api/admin/logout',{method:'POST'});setAuthenticated(false);setProducts([]);setSelected(null);setDraft({...blank,imageUrls:[]});setStatus('')};
 const filtered=useMemo(()=>products.filter(p=>(p.title+' '+(p.sku||'')+' '+(p.oem||'')).toLowerCase().includes(q.toLowerCase())),[products,q]);
 const normalize=(p:Product)=>({...p,imageUrls:(p.imageUrls?.length?p.imageUrls:(p.imageUrl?[p.imageUrl]:[]))});
 const choose=(p:Product)=>{setSelected(p);setDraft(normalize(p));window.scrollTo({top:0,behavior:'smooth'})};
 const newProduct=()=>{setSelected(null);setDraft({...blank,imageUrls:[]});window.scrollTo({top:0,behavior:'smooth'})};
 const save=async()=>{setBusy(true);setStatus('Сохраняю…');const url=selected?`/api/products/${selected.id}`:'/api/products';const payload={...draft,imageUrl:draft.imageUrls?.[0]||draft.imageUrl||null};const r=await fetch(url,{method:selected?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const j=await r.json();if(r.status===401){setAuthenticated(false);setStatus('Сессия истекла');setBusy(false);return;}if(!r.ok){setStatus(j.error||'Ошибка сохранения');setBusy(false);return;}setStatus('✓ Сохранено');await load();setSelected(j);setDraft(normalize(j));setBusy(false)};
 const uploadFiles=async(files:File[])=>{if(!files.length)return; if(files.length>12){setStatus('Можно выбрать не более 12 фото');return;} setUploading(true);setStatus(`Загружаю фото: 0/${files.length}`);const uploaded:string[]=[];for(let i=0;i<files.length;i++){const fd=new FormData();fd.append('file',files[i]);const r=await fetch('/api/admin/upload',{method:'POST',body:fd});const j=await r.json();if(!r.ok){setStatus(j.error||`Ошибка загрузки ${files[i].name}`);setUploading(false);return;}uploaded.push(j.url);setStatus(`Загружаю фото: ${i+1}/${files.length}`);}setDraft((d:any)=>{const existing=(d.imageUrls||[]).filter(Boolean);const merged=[...existing,...uploaded].filter((u,i,a)=>a.indexOf(u)===i).slice(0,12);return {...d,imageUrls:merged,imageUrl:merged[0]||''};});setStatus(`✓ Загружено ${uploaded.length} фото. Сохраните товар.`);setUploading(false)};
 const makeMain=(url:string)=>setDraft((d:any)=>{const imgs=[url,...(d.imageUrls||[]).filter((x:string)=>x!==url)];return {...d,imageUrls:imgs,imageUrl:url}});
 const removeImage=(url:string)=>setDraft((d:any)=>{const imgs=(d.imageUrls||[]).filter((x:string)=>x!==url);return {...d,imageUrls:imgs,imageUrl:imgs[0]||''}});
 const moveImage=(index:number,dir:-1|1)=>setDraft((d:any)=>{const imgs=[...(d.imageUrls||[])];const to=index+dir;if(to<0||to>=imgs.length)return d;[imgs[index],imgs[to]]=[imgs[to],imgs[index]];return {...d,imageUrls:imgs,imageUrl:imgs[0]||''}});
 const remove=async()=>{if(!selected||!confirm(`Удалить «${selected.title}»?`))return;setBusy(true);const r=await fetch(`/api/products/${selected.id}`,{method:'DELETE'});const j=await r.json();if(r.status===401){setAuthenticated(false);setStatus('Сессия истекла');setBusy(false);return;}if(!r.ok){setStatus(j.error||'Ошибка удаления');setBusy(false);return;}setSelected(null);setDraft({...blank,imageUrls:[]});setStatus('✓ Товар удалён');await load();setBusy(false)};
 if(authenticated===null) return <main className="admin-shell"><section className="admin-card"><h1>TechRoom Admin</h1><p>Проверяем сессию…</p></section></main>;
 if(!authenticated) return <main className="admin-shell"><section className="admin-card editor" style={{maxWidth:520,margin:'60px auto'}}><a href="/" className="back">← На сайт</a><h1>TechRoom Admin</h1><p>Войдите, чтобы управлять каталогом.</p><div className="form-grid"><label className="wide">Пароль администратора<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!busy)login()}} placeholder="Пароль"/></label></div><div className="editor-actions"><button className="save-btn" disabled={busy||password.length<1} onClick={login}>{busy?'Подождите…':'Войти'}</button></div>{status&&<p>{status}</p>}</section></main>;
 const images:string[]=(draft.imageUrls||[]).filter(Boolean);
 return <main className="admin-shell">
  <div className="admin-top"><div><a href="/" className="back">← На сайт</a><h1>TechRoom Admin</h1><p>Управление каталогом товаров · Cloudinary Upload v2</p></div><div style={{display:'flex',gap:10}}><button className="new-btn" onClick={newProduct}>＋ Новый товар</button><button className="edit-btn" onClick={logout}>Выйти</button></div></div>
  <section className="admin-card editor">
   <div className="editor-head"><div><h2>{selected?`Редактирование #${selected.id}`:'Новый товар'}</h2><span>{status}</span></div></div>
   <div className="form-grid">
    <label className="wide">Название<input maxLength={200} value={draft.title||''} onChange={e=>setDraft({...draft,title:e.target.value})} placeholder="Название товара"/></label>
    <label>Категория<select value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value})}>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
    <label>Цена, ₽<input type="number" min="0" max="100000000" value={draft.price} onChange={e=>setDraft({...draft,price:Number(e.target.value)})}/></label>
    <label>Старая цена, ₽<input type="number" min="0" max="100000000" value={draft.oldPrice||''} onChange={e=>setDraft({...draft,oldPrice:e.target.value?Number(e.target.value):null})}/></label>
    <label>Остаток<input type="number" min="0" max="10000000" value={draft.stock} onChange={e=>setDraft({...draft,stock:Number(e.target.value)})}/></label>
    <label>SKU / артикул<input maxLength={100} value={draft.sku||''} onChange={e=>setDraft({...draft,sku:e.target.value})}/></label>
    <label>OEM<input maxLength={100} value={draft.oem||''} onChange={e=>setDraft({...draft,oem:e.target.value})}/></label>
    <label>Бейдж<input maxLength={40} value={draft.badge||''} onChange={e=>setDraft({...draft,badge:e.target.value})} placeholder="Хит / Новинка"/></label>
    <label>Emoji<input maxLength={16} value={draft.emoji||''} onChange={e=>setDraft({...draft,emoji:e.target.value})}/></label>
    <label>Рейтинг<input type="number" min="0" max="5" step="0.1" value={draft.rating} onChange={e=>setDraft({...draft,rating:Number(e.target.value)})}/></label>
    <label>Отзывы<input type="number" min="0" max="10000000" value={draft.reviews} onChange={e=>setDraft({...draft,reviews:Number(e.target.value)})}/></label>
    <label>Порядок<input type="number" min="-1000000" max="1000000" value={draft.sortOrder} onChange={e=>setDraft({...draft,sortOrder:Number(e.target.value)})}/></label>

    <div className="wide photo-manager">
      <div className="photo-manager-head"><div><b>Фотографии товара</b><small>До 12 фото. Первое изображение — главное.</small></div><label className={'upload-btn '+(uploading?'disabled':'')}>＋ {uploading?'Загрузка…':'Загрузить фотографии'}<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" disabled={uploading} onChange={e=>{const f=Array.from(e.target.files||[]);uploadFiles(f);e.currentTarget.value=''}}/></label></div>
      {!images.length?<div className="upload-empty">Перетащи или выбери JPG, PNG, WebP или AVIF. После загрузки появится превью.</div>:
      <div className="photo-grid">{images.map((url,index)=><div className={'photo-item '+(index===0?'main-photo':'')} key={url}>
        <img src={url} alt={`Фото ${index+1}`}/>{index===0&&<span className="main-badge">Главное</span>}
        <div className="photo-controls"><button type="button" onClick={()=>makeMain(url)}>★</button><button type="button" disabled={index===0} onClick={()=>moveImage(index,-1)}>←</button><button type="button" disabled={index===images.length-1} onClick={()=>moveImage(index,1)}>→</button><button type="button" className="danger-mini" onClick={()=>removeImage(url)}>×</button></div>
      </div>)}</div>}
      <details className="manual-url"><summary>Вставить ссылку вручную</summary><input maxLength={1000} value={draft.imageUrl||''} onChange={e=>{const url=e.target.value;setDraft({...draft,imageUrl:url,imageUrls:url?[url,...images.filter(x=>x!==url)]:images})}} placeholder="https://..."/></details>
    </div>

    <label className="wide">Описание<textarea maxLength={5000} rows={4} value={draft.description||''} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
    <label className="wide">Характеристики<textarea maxLength={10000} rows={5} value={draft.specs||''} onChange={e=>setDraft({...draft,specs:e.target.value})} placeholder={'Материал: ASA\nЦвет: чёрный'}/></label>
    <label className="toggle"><input type="checkbox" checked={draft.isActive} onChange={e=>setDraft({...draft,isActive:e.target.checked})}/> Показывать на сайте</label>
   </div>
   <div className="editor-actions"><button className="save-btn" disabled={busy||uploading||!draft.title} onClick={save}>{busy?'Подождите…':'Сохранить товар'}</button>{selected&&<button className="delete-btn" disabled={busy} onClick={remove}>Удалить</button>}</div>
  </section>
  <section className="admin-card list-card"><div className="list-head"><div><h2>Товары</h2><span>{products.length} позиций</span></div><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Поиск по названию, SKU, OEM"/></div>
   <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>ID</th><th>Товар</th><th>Категория</th><th>Цена</th><th>Остаток</th><th>SKU / OEM</th><th></th></tr></thead><tbody>{filtered.map(p=><tr key={p.id}><td>{p.id}</td><td><div className="table-product">{p.imageUrl?<img src={p.imageUrl} alt=""/>:<span>{p.emoji||'📦'}</span>}<div><b>{p.title}</b>{!p.isActive&&<small>Скрыт</small>}</div></div></td><td>{p.category}</td><td>{p.price.toLocaleString('ru-RU')} ₽</td><td>{p.stock}</td><td><small>{p.sku||'—'}<br/>{p.oem||''}</small></td><td><button className="edit-btn" onClick={()=>choose(p)}>Изменить</button></td></tr>)}</tbody></table></div>
  </section>
 </main>
}
