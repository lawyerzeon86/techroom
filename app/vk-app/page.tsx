'use client';
import { useEffect,useMemo,useState } from 'react';

type Product={id:number;title:string;price:number;stock:number;category?:string;imageUrl?:string;imageUrls?:string[];description?:string;sku?:string};
type Cart=Record<number,number>;

const money=(n:number)=>new Intl.NumberFormat('ru-RU').format(n)+' ₽';

export default function VkAppPage(){
  const [products,setProducts]=useState<Product[]>([]);
  const [cart,setCart]=useState<Cart>({});
  const [q,setQ]=useState('');
  const [category,setCategory]=useState('all');
  const [checkout,setCheckout]=useState(false);
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState('');
  const [form,setForm]=useState({customerName:'',phone:'',email:'',deliveryMethod:'courier',address:'',paymentMethod:'qr',comment:''});

  useEffect(()=>{fetch('/api/products',{cache:'no-store'}).then(r=>r.json()).then(j=>setProducts(Array.isArray(j)?j:[])).catch(()=>setMsg('Не удалось загрузить каталог'));const saved=localStorage.getItem('techroom-vk-cart');if(saved){try{setCart(JSON.parse(saved))}catch{}}},[]);
  useEffect(()=>{localStorage.setItem('techroom-vk-cart',JSON.stringify(cart))},[cart]);

  const categories=useMemo(()=>Array.from(new Set(products.map(p=>p.category||'Другое'))).sort(),[products]);
  const filtered=useMemo(()=>products.filter(p=>(category==='all'||(p.category||'Другое')===category)&&`${p.title} ${p.description||''} ${p.sku||''}`.toLowerCase().includes(q.toLowerCase())),[products,category,q]);
  const lines=useMemo(()=>products.filter(p=>cart[p.id]).map(p=>({...p,quantity:cart[p.id]})),[products,cart]);
  const total=lines.reduce((s,p)=>s+p.price*p.quantity,0);
  const count=lines.reduce((s,p)=>s+p.quantity,0);
  const add=(id:number)=>setCart(c=>({...c,[id]:Math.min(99,(c[id]||0)+1)}));
  const dec=(id:number)=>setCart(c=>{const n=(c[id]||0)-1;const next={...c};if(n<=0)delete next[id];else next[id]=n;return next});

  const submit=async()=>{
    if(!lines.length)return;
    setBusy(true);setMsg('');
    try{
      const r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,items:lines.map(x=>({productId:x.id,quantity:x.quantity}))})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){setMsg(j.error||'Не удалось оформить заказ');return;}
      setCart({});setCheckout(false);setMsg(`Заказ ${j.orderNumber} оформлен на ${money(j.totalAmount||0)}`);
    }catch{setMsg('Ошибка сети');}finally{setBusy(false)}
  };

  return <main style={{maxWidth:980,margin:'0 auto',padding:'16px',fontFamily:'Arial,sans-serif',color:'#111'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,position:'sticky',top:0,background:'#fff',padding:'10px 0',zIndex:5,borderBottom:'1px solid #eee'}}>
      <div><h1 style={{margin:0,fontSize:24}}>TechRoom</h1><small>Магазин во ВКонтакте</small></div>
      <button onClick={()=>setCheckout(v=>!v)} style={{border:0,borderRadius:12,padding:'12px 16px',background:'#111',color:'#fff',fontWeight:700}}>Корзина · {count} · {money(total)}</button>
    </div>

    {msg&&<div style={{margin:'14px 0',padding:12,borderRadius:12,background:'#f3f3f3'}}>{msg}</div>}

    {checkout?<section style={{paddingTop:16}}>
      <h2>Корзина</h2>
      {!lines.length?<p>Корзина пуста.</p>:<>
        {lines.map(p=><div key={p.id} style={{display:'grid',gridTemplateColumns:'64px 1fr auto',gap:12,alignItems:'center',padding:'12px 0',borderBottom:'1px solid #eee'}}>
          <img src={p.imageUrl||p.imageUrls?.[0]||'/placeholder.svg'} alt="" style={{width:64,height:64,objectFit:'cover',borderRadius:10}}/>
          <div><b>{p.title}</b><div>{money(p.price)}</div></div>
          <div style={{display:'flex',alignItems:'center',gap:8}}><button onClick={()=>dec(p.id)}>-</button><b>{p.quantity}</b><button onClick={()=>add(p.id)}>+</button></div>
        </div>)}
        <h3>Итого: {money(total)}</h3>
        <div style={{display:'grid',gap:10,maxWidth:520}}>
          <input placeholder="Имя" value={form.customerName} onChange={e=>setForm({...form,customerName:e.target.value})}/>
          <input placeholder="Телефон" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/>
          <input placeholder="Email (необязательно)" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/>
          <select value={form.deliveryMethod} onChange={e=>setForm({...form,deliveryMethod:e.target.value})}><option value="courier">Доставка</option><option value="pickup">Самовывоз</option></select>
          {form.deliveryMethod==='courier'&&<input placeholder="Адрес доставки" value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/>} 
          <select value={form.paymentMethod} onChange={e=>setForm({...form,paymentMethod:e.target.value})}><option value="qr">Оплата по QR</option><option value="cash">При получении</option></select>
          <textarea placeholder="Комментарий" value={form.comment} onChange={e=>setForm({...form,comment:e.target.value})}/>
          <button disabled={busy} onClick={submit} style={{border:0,borderRadius:12,padding:'14px 16px',background:'#111',color:'#fff',fontWeight:700}}>{busy?'Оформляем…':'Оформить заказ'}</button>
        </div>
      </>}
    </section>:<>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',padding:'16px 0'}}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Поиск товаров" style={{flex:'1 1 220px'}}/>
        <select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">Все категории</option>{categories.map(c=><option key={c}>{c}</option>)}</select>
      </div>
      <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:12}}>
        {filtered.map(p=><article key={p.id} style={{border:'1px solid #eee',borderRadius:16,padding:10,background:'#fff'}}>
          <img src={p.imageUrl||p.imageUrls?.[0]||'/placeholder.svg'} alt={p.title} style={{width:'100%',aspectRatio:'1/1',objectFit:'cover',borderRadius:12}}/>
          <h3 style={{fontSize:16,minHeight:40}}>{p.title}</h3>
          <div style={{fontSize:18,fontWeight:800}}>{money(p.price)}</div>
          <small>{p.stock>0?`В наличии: ${p.stock}`:'Нет в наличии'}</small>
          <button disabled={p.stock<=0} onClick={()=>add(p.id)} style={{marginTop:10,width:'100%',border:0,borderRadius:10,padding:10,background:'#111',color:'#fff'}}>В корзину</button>
        </article>)}
      </section>
    </>}
  </main>;
}
