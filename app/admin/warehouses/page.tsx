'use client';
import { useEffect,useState } from 'react';

type Warehouse={id:string;name:string;isRfbs?:boolean};

export default function WarehousesPage(){
  const [items,setItems]=useState<{wildberries:Warehouse[];ozon:Warehouse[]}>({wildberries:[],ozon:[]});
  const [selected,setSelected]=useState({wbWarehouseId:'',ozonWarehouseId:''});
  const [errors,setErrors]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  async function load(){
    setBusy(true); setMessage('Загружаем склады…');
    try{
      const r=await fetch('/api/admin/integrations/warehouses',{cache:'no-store'});
      const j=await r.json();
      if(!r.ok) throw new Error(j.error||String(r.status));
      setItems(j.warehouses||{wildberries:[],ozon:[]});
      setSelected({wbWarehouseId:j.settings?.wbWarehouseId||'',ozonWarehouseId:j.settings?.ozonWarehouseId||''});
      setErrors(j.errors||{}); setMessage('Склады загружены');
    }catch(e:any){setMessage('Ошибка: '+String(e?.message||e))} finally{setBusy(false)}
  }

  async function save(){
    setBusy(true); setMessage('Сохраняем…');
    try{
      const r=await fetch('/api/admin/integrations/warehouses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(selected)});
      const j=await r.json();
      if(!r.ok) throw new Error(j.error||String(r.status));
      setMessage('✓ Склады сохранены. Автосинхронизация остатков будет использовать этот выбор.');
    }catch(e:any){setMessage('Ошибка: '+String(e?.message||e))} finally{setBusy(false)}
  }

  useEffect(()=>{load()},[]);
  return <main className="admin-shell">
    <div className="admin-top"><div><h1>Склады маркетплейсов</h1><p>Выбери FBS/rFBS склад для синхронизации остатков</p></div><button className="edit-btn" disabled={busy} onClick={load}>Обновить</button></div>
    <section className="admin-card editor">
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:20}}>
        <label style={{display:'grid',gap:8}}><b>Wildberries</b><select value={selected.wbWarehouseId} onChange={e=>setSelected(s=>({...s,wbWarehouseId:e.target.value}))}><option value="">— выберите склад —</option>{items.wildberries.map(w=><option key={w.id} value={w.id}>{w.name} — ID {w.id}</option>)}</select>{errors.wildberries&&<small style={{color:'#a15b18'}}>WB: {errors.wildberries}</small>}</label>
        <label style={{display:'grid',gap:8}}><b>Ozon</b><select value={selected.ozonWarehouseId} onChange={e=>setSelected(s=>({...s,ozonWarehouseId:e.target.value}))}><option value="">— выберите склад —</option>{items.ozon.map(w=><option key={w.id} value={w.id}>{w.name} — ID {w.id}{w.isRfbs?' · rFBS':''}</option>)}</select>{errors.ozon&&<small style={{color:'#a15b18'}}>Ozon: {errors.ozon}</small>}</label>
      </div>
      <div className="editor-actions" style={{marginTop:18}}><button className="save-btn" disabled={busy||(!selected.wbWarehouseId&&!selected.ozonWarehouseId)} onClick={save}>Сохранить выбранные склады</button></div>
      {message&&<p>{message}</p>}
    </section>
  </main>
}
