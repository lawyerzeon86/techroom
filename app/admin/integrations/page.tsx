'use client';
import { useEffect,useState } from 'react';

type Name='wildberries'|'ozon';

export default function Page(){
 const [cfg,setCfg]=useState({wildberries:false,ozon:false});
 const [busy,setBusy]=useState('');
 const [msg,setMsg]=useState<Record<string,string>>({});
 const load=async()=>{const r=await fetch('/api/admin/integrations/status',{cache:'no-store'});const j=await r.json().catch(()=>({}));if(r.ok)setCfg(j.configured||cfg);else setMsg({global:r.status===401?'Сначала войдите в админку':(j.error||'Ошибка')})};
 useEffect(()=>{load()},[]);
 const run=async(name:Name,action:'test'|'sync')=>{const k=`${name}-${action}`;setBusy(k);setMsg(m=>({...m,[name]:action==='test'?'Проверяем…':'Синхронизируем…'}));const r=await fetch(`/api/admin/integrations/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({marketplace:name})});const j=await r.json().catch(()=>({}));setMsg(m=>({...m,[name]:r.ok?(action==='test'?'✓ Подключение работает':`✓ Синхронизировано: ${j.synced||0}`):`Ошибка: ${j.error||r.status}`}));setBusy('')};
 const card=(name:Name,title:string,setup:string)=>{const ok=cfg[name];return <section className="admin-card editor"><div className="editor-head"><div><h2>{title}</h2><span>Синхронизация заказов</span></div><b>{ok?'● Настроено':'○ Не настроено'}</b></div><p>{setup}</p><div className="editor-actions"><button className="edit-btn" disabled={!ok||!!busy} onClick={()=>run(name,'test')}>{busy===`${name}-test`?'Проверка…':'Проверить'}</button><button className="save-btn" disabled={!ok||!!busy} onClick={()=>run(name,'sync')}>{busy===`${name}-sync`?'Синхронизация…':'Синхронизировать'}</button></div>{msg[name]&&<p>{msg[name]}</p>}</section>};
 return <main className="admin-shell"><div className="admin-top"><div><h1>Интеграции</h1><p>Wildberries и Ozon Seller API</p></div><button className="edit-btn" onClick={load}>Обновить</button></div>{msg.global&&<section className="admin-card editor"><p>{msg.global} <a href="/admin">Войти</a></p></section>}{card('wildberries','Wildberries','Добавьте токен Wildberries в Environment сервиса Render.')}{card('ozon','Ozon','Добавьте Client ID и API key Ozon в Environment сервиса Render.')}<section className="admin-card editor"><h2>Общий список заказов</h2><p>После синхронизации откройте <a href="/admin/orders">Заказы</a>.</p></section></main>
}
