'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addToCart, cartCount, CART_EVENT, loadCart } from '../lib/cart-client';

type Product = { id:number; category:string; title:string; price:number; oldPrice?:number|null; rating:number; reviews:number; badge?:string|null; emoji?:string|null; imageUrl?:string|null; sku?:string|null; oem?:string|null; stock:number; description?:string|null; specs?:string|null; isActive:boolean; sortOrder:number };
const fallbackProducts: Product[] = [
  {id:1,category:'Автозапчасти',title:'Тормозные диски и колодки Brembo (комплект)',price:12990,rating:4.8,reviews:124,badge:'Хит',emoji:'◉',stock:8,isActive:true,sortOrder:10},
  {id:2,category:'Электроника',title:'Беспроводные наушники Apple AirPods Pro 2',price:24990,rating:4.9,reviews:312,emoji:'◌',stock:12,isActive:true,sortOrder:20},
  {id:3,category:'Гаджеты',title:'Смарт-часы Xiaomi Watch S3',price:16990,rating:4.7,reviews:198,emoji:'⌚',stock:7,isActive:true,sortOrder:30},
  {id:4,category:'3D-печать',title:'PETG пластик для 3D-принтера (1 кг, чёрный)',price:1990,rating:4.8,reviews:76,emoji:'◍',stock:25,isActive:true,sortOrder:40},
  {id:5,category:'Автозапчасти',title:'Фара передняя LED для Audi A4 B9',price:45990,rating:4.6,reviews:42,badge:'Новинка',emoji:'▰',stock:3,isActive:true,sortOrder:50},
];
const rooms = [
  {id:'auto', title:'Автозапчасти', sub:'Для твоего автомобиля', icon:'🚗', cls:'auto'},
  {id:'electronics', title:'Электроника', sub:'Технологии рядом', icon:'⚡', cls:'electronics'},
  {id:'gadgets', title:'Гаджеты', sub:'Удобство в деталях', icon:'🎧', cls:'gadgets'},
  {id:'print', title:'3D-печать', sub:'Печатай свои идеи', icon:'🧊', cls:'print'},
];

const money=(n:number)=>new Intl.NumberFormat('ru-RU').format(n)+' ₽';

function Icon({name}:{name:string}){
 const paths:any={search:'M11 19a8 8 0 1 1 5.66-2.34L22 22',heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8',cart:'M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 1.9-1.4L22 8H6',user:'M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8',truck:'M3 7h11v10H3zM14 10h4l3 3v4h-7zM7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4M18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4',shield:'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z',star:'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z'};
 return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]||paths.star}/></svg>
}

export default function Home(){
 const router=useRouter();
 const [cartItems,setCartItems]=useState(0); const [active,setActive]=useState('all'); const [q,setQ]=useState(''); const [notice,setNotice]=useState(''); const [products,setProducts]=useState<Product[]>(fallbackProducts);
 useEffect(()=>{
   const sync=()=>setCartItems(cartCount(loadCart()));
   sync();
   window.addEventListener(CART_EVENT,sync);
   fetch('/api/products',{cache:'no-store'}).then(async r=>{if(!r.ok) throw new Error(); return r.json()}).then(setProducts).catch(()=>{});
   return ()=>window.removeEventListener(CART_EVENT,sync);
 },[]);
 const filtered=useMemo(()=>products.filter(p=>(active==='all'||p.category===active)&&p.title.toLowerCase().includes(q.toLowerCase())),[products,active,q]);
 const add=(id:number)=>{addToCart(id,1);setCartItems(cartCount(loadCart()));setNotice('Товар добавлен в корзину');setTimeout(()=>setNotice(''),1800)};
 const scroll=(id:string)=>document.getElementById(id)?.scrollIntoView({behavior:'smooth'});
 return <main>
  {notice&&<div className="toast">✓ {notice}</div>}
  <header className="header">
   <div className="topbar wrap">
    <div className="brand" onClick={()=>scroll('home')}><div className="logo">⌂</div><div><b>Tech<span>Room</span></b><small>Техника. Запчасти. Идеи.</small></div></div>
    <div className="search"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Поиск товаров, брендов, категорий..."/><Icon name="search"/></div>
    <div className="actions"><button><Icon name="heart"/> Избранное</button><button onClick={()=>router.push('/cart')}><Icon name="cart"/> Корзина <i>{cartItems}</i></button><button><Icon name="user"/> Войти / Регистрация</button></div>
   </div>
   <nav className="nav wrap"><a className="active" onClick={()=>scroll('home')}>Главная</a><a onClick={()=>setActive('Автозапчасти')}>Автозапчасти</a><a onClick={()=>setActive('Электроника')}>Электроника</a><a onClick={()=>setActive('Гаджеты')}>Гаджеты</a><a onClick={()=>setActive('3D-печать')}>3D-печать</a><a onClick={()=>scroll('offers')}>Акции</a><a>О магазине</a><a>Доставка и оплата</a><a>Контакты</a></nav>
  </header>

  <section id="home" className="hero wrap">
   <div className="hero-title"><h1>Добро пожаловать в <span>TechRoom!</span></h1><p>Выбери свою комнату и найди то, что нужно</p></div>
   <div className="rooms">{rooms.map(r=><div key={r.id} className={'room '+r.cls} onClick={()=>{setActive(r.title);scroll('products')}}><div className="room-icon">{r.icon}</div><div className="room-title">{r.title}</div><div className="room-sub">{r.sub}</div><button>Перейти →</button></div>)}</div>
  </section>

  <section className="benefits"><div className="wrap benefit-grid">{[['truck','Быстрая доставка','по всей России'],['shield','Гарантия качества','на все товары'],['star','Оплата по QR','и все способы оплаты'],['heart','Поддержка 24/7','ответим на любые вопросы'],['star','Бонусы и скидки','для постоянных клиентов']].map((b,i)=><div className="benefit" key={i}><Icon name={b[0]}/><div><b>{b[1]}</b><small>{b[2]}</small></div></div>)}</div></section>

  <section id="products" className="section wrap"><div className="section-head"><div><h2>Популярные товары</h2><p>Хиты продаж, которые выбирают наши клиенты</p></div><button className="link" onClick={()=>setActive('all')}>Смотреть все →</button></div>
   <div className="filters"><button className={active==='all'?'sel':''} onClick={()=>setActive('all')}>Все</button>{rooms.map(r=><button key={r.id} className={active===r.title?'sel':''} onClick={()=>setActive(r.title)}>{r.title}</button>)}</div>
   <div className="products">{filtered.map(p=><article className="product" key={p.id} role="link" tabIndex={0} onClick={()=>router.push(`/product/${p.id}`)} onKeyDown={e=>{if(e.key==='Enter')router.push(`/product/${p.id}`)}}><div className="pic">{p.badge&&<span className="badge">{p.badge}</span>}<button className="fav" onClick={e=>e.stopPropagation()}><Icon name="heart"/></button>{p.imageUrl?<img className="product-image" src={p.imageUrl} alt={p.title}/>:<div className="product-art">{p.emoji||'📦'}</div>}</div><small>{p.category}</small><h3>{p.title}</h3><div className="rating"><span>★ {p.rating}</span> ({p.reviews}) <em>{p.stock>0?'● В наличии':'○ Нет в наличии'}</em></div><div className="price-row"><strong>{money(p.price)}</strong>{p.oldPrice&&p.oldPrice>p.price?<del>{money(p.oldPrice)}</del>:null}</div><button className="buy" disabled={p.stock<=0} onClick={e=>{e.stopPropagation();add(p.id)}}><Icon name="cart"/> {p.stock>0?'В корзину':'Нет в наличии'}</button></article>)}</div>
   {!filtered.length&&<div className="empty">Ничего не нашли. Попробуйте изменить запрос или категорию.</div>}
  </section>

  <section id="offers" className="offers"><div className="wrap"><div className="section-head"><div><h2>Акции и спецпредложения</h2><p>Выгодные предложения в каждой комнате</p></div><button className="link">Все акции →</button></div><div className="offer-grid">{[['Автозапчасти','Скидки до 30%','На популярные запчасти','auto'],['Электроника','Скидки до 20%','На технику и аксессуары','electronics'],['Гаджеты','Лучшие цены на хиты','На популярные гаджеты','gadgets'],['3D-печать','Скидка 15% на пластик','На расходные материалы','print']].map((o,i)=><div className={'offer '+o[3]} key={i}><small>{o[0]}</small><b>{o[1]}</b><span>{o[2]}</span><button>Перейти →</button></div>)}</div></div></section>

  <section id="cart" className="cart-band"><div className="wrap cart-row"><div><b>Корзина</b><span>{cartItems?` ${cartItems} товар(ов) добавлено`:' пока пуста'}</span></div><button onClick={()=>router.push('/cart')}>{cartItems?'Перейти к оформлению →':'Открыть корзину →'}</button></div></section>

  <footer><div className="wrap footer-grid"><div className="brand"><div className="logo">⌂</div><div><b>Tech<span>Room</span></b><small>Техника. Запчасти. Идеи.</small></div></div><div><h4>Каталог</h4><a>Автозапчасти</a><a>Электроника</a><a>Гаджеты</a><a>3D-печать</a></div><div><h4>Информация</h4><a>О магазине</a><a>Доставка и оплата</a><a>Гарантия</a><a>Контакты</a></div><div><h4>Мы в соцсетях</h4><div className="social">VK　TG　▶　◎</div></div><div><h4>Будьте в курсе новинок и акций</h4><div className="subscribe"><input placeholder="Ваш email"/><button>Подписаться</button></div></div></div><div className="wrap copyright">© 2026 TechRoom. Все права защищены. <span>Политика конфиденциальности　 Пользовательское соглашение</span></div></footer>
 </main>
}
