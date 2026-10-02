'use client';
import { useEffect,useMemo,useState } from 'react';

type Thread={phone:string;profile_name?:string;last_message_at?:string;unread_count:number;last_text?:string;order_id?:number|null};
type Msg={id:number;wa_message_id?:string;phone:string;direction:'in'|'out';message_type:string;text?:string;status?:string;created_at:string};

export default function WhatsAppPage(){
  const [threads,setThreads]=useState<Thread[]>([]);const [phone,setPhone]=useState('');const [messages,setMessages]=useState<Msg[]>([]);
  const [status,setStatus]=useState<any>(null);const [text,setText]=useState('');const [notice,setNotice]=useState('');const [loading,setLoading]=useState(false);
  const current=useMemo(()=>threads.find(x=>x.phone===phone),[threads,phone]);
  const loadThreads=async()=>{const r=await fetch('/api/admin/whatsapp',{cache:'no-store'});const j=await r.json().catch(()=>({}));if(!r.ok){setNotice(j.error||`HTTP ${r.status}`);return}setThreads(j.threads||[]);setStatus(j.status);if(!phone&&j.threads?.[0]?.phone)setPhone(j.threads[0].phone)};
  const loadMessages=async(p:string)=>{if(!p)return;const r=await fetch(`/api/admin/whatsapp?phone=${encodeURIComponent(p)}`,{cache:'no-store'});const j=await r.json().catch(()=>({}));if(r.ok){setMessages(j.messages||[]);setStatus(j.status)}else setNotice(j.error||`HTTP ${r.status}`)};
  useEffect(()=>{loadThreads()},[]);useEffect(()=>{if(phone)loadMessages(phone)},[phone]);
  useEffect(()=>{const id=setInterval(()=>{loadThreads();if(phone)loadMessages(phone)},15000);return()=>clearInterval(id)},[phone]);
  const send=async()=>{const clean=text.trim();if(!phone||!clean)return;setLoading(true);setNotice('Отправка…');try{const r=await fetch('/api/admin/whatsapp/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,text:clean})});const j=await r.json().catch(()=>({}));if(!r.ok){setNotice(`Ошибка: ${j.error||r.status}`);return}setText('');setNotice('✓ Отправлено');await loadMessages(phone);await loadThreads()}finally{setLoading(false)}};
  return <main className="admin-shell">
    <div className="admin-top"><div><h1>WhatsApp Business</h1><p>Диалоги покупателей Duisun через WhatsApp Cloud API</p></div><button className="edit-btn" onClick={()=>{loadThreads();if(phone)loadMessages(phone)}}>Обновить</button></div>
    <section className="admin-card editor" style={{marginBottom:14}}>
      <div style={{display:'flex',gap:14,alignItems:'center',flexWrap:'wrap'}}><b>Статус:</b><span>{status?.configured?'✓ API настроен':'Ожидает подключения Meta'}</span><span>Graph API: {status?.graphVersion||'—'}</span><span>{notice}</span></div>
      <p style={{margin:'10px 0 0',opacity:.75}}>Webhook: <code>/api/webhooks/whatsapp</code></p>
    </section>
    <div style={{display:'grid',gridTemplateColumns:'minmax(260px,360px) minmax(0,1fr)',gap:14,alignItems:'start'}}>
      <section className="admin-card editor" style={{padding:0,overflow:'hidden'}}>
        <div style={{padding:14,borderBottom:'1px solid #eee4d9'}}><b>Диалоги</b></div>
        <div style={{maxHeight:'70vh',overflowY:'auto'}}>{threads.length?threads.map(t=><button key={t.phone} onClick={()=>setPhone(t.phone)} style={{width:'100%',textAlign:'left',padding:14,border:0,borderBottom:'1px solid #f0e7df',background:phone===t.phone?'#fff3e8':'#fff',cursor:'pointer'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8}}><b>{t.profile_name||`+${t.phone}`}</b>{t.unread_count>0?<span style={{background:'#25D366',color:'#fff',borderRadius:999,padding:'2px 7px',fontSize:12}}>{t.unread_count}</span>:null}</div>
          <div style={{fontSize:12,opacity:.7,marginTop:4}}>+{t.phone}{t.order_id?` · заказ #${t.order_id}`:''}</div><div style={{fontSize:13,marginTop:6,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t.last_text||'Без текста'}</div>
        </button>):<div style={{padding:16}}>Пока нет сообщений.</div>}</div>
      </section>
      <section className="admin-card editor" style={{minHeight:420}}>
        {phone?<><div className="editor-head"><div><h2>{current?.profile_name||`+${phone}`}</h2><span>+{phone}{current?.order_id?` · заказ #${current.order_id}`:''}</span></div></div>
        <div style={{height:'48vh',minHeight:300,overflowY:'auto',display:'flex',flexDirection:'column',gap:8,padding:'8px 2px 16px'}}>{messages.map(m=><div key={m.id} style={{alignSelf:m.direction==='out'?'flex-end':'flex-start',maxWidth:'78%',background:m.direction==='out'?'#dcf8c6':'#f3eee8',borderRadius:12,padding:'9px 11px'}}>
          <div style={{whiteSpace:'pre-wrap'}}>{m.text||`[${m.message_type}]`}</div><div style={{fontSize:11,opacity:.6,marginTop:4}}>{new Date(m.created_at).toLocaleString('ru-RU')} {m.direction==='out'&&m.status?`· ${m.status}`:''}</div>
        </div>)}</div>
        <div style={{display:'flex',gap:8}}><textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}} rows={3} maxLength={4096} placeholder="Сообщение клиенту" style={{flex:1,border:'1px solid #ded4ca',borderRadius:10,padding:11,font:'inherit'}}/><button className="save-btn" disabled={loading||!text.trim()} onClick={send}>{loading?'…':'Отправить'}</button></div></>:<p>Выберите диалог.</p>}
      </section>
    </div>
  </main>;
}
