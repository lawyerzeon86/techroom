'use client';
import { useMemo, useState } from 'react';

type Product = { id:number; cat:string; title:string; price:number; old?:number; rating:number; reviews:number; badge?:string; emoji:string };
const rooms = [
  {id:'auto', title:'Автозапчасти', sub:'Для твоего автомобиля', icon:'🚗', cls:'auto'},
  {id:'electronics', title:'Электроника', sub:'Технологии рядом', icon:'⚡', cls:'electronics'},
  {id:'gadgets', title:'Гаджеты', sub:'Удобство в деталях', icon:'🎧', cls:'gadgets'},
  {id:'print', title:'3D-печать', sub:'Печатай свои идеи', icon:'🧊', cls:'print'},
];
const products: Product[] = [
  {id:1,cat:'Автозапчасти',title:'Тормозные диски и колодки Brembo (комплект)',price:12990,rating:4.8,reviews:124,badge:'Хит',emoji:'◉'},
  {id:2,cat:'Электроника',title:'Беспроводные наушники Apple AirPods Pro 2',price:24990,rating:4.9,reviews:312,emoji:'◌'},
  {id:3,cat:'Гаджеты',title:'Смарт-часы Xiaomi Watch S3',price:16990,rating:4.7,reviews:198,emoji:'⌚'},
  {id:4,cat:'3D-печать',title:'PETG пластик для 3D-принтера (1 кг, чёрный)',price:1990,rating:4.8,reviews:76,emoji:'◍'},
  {id:5,cat:'Автозапчасти',title:'Фара передняя LED для Audi A4 B9',price:45990,rating:4.6,reviews:42,badge:'Новинка',emoji:'▰'},
];

const money=(n:number)=>new Intl.NumberFormat('ru-RU').format(n)+' ₽';

function Icon({name}:{name:string}){
 const paths:any={search:'M11 19a8 8 0 1 1 5.66-2.34L22 22',heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8',cart:'M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 1.9-1.4L22 8H6',user:'M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8',truck:'M3 7h11v10H3zM14 10h4l3 3v4h-7zM7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4M18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4',shield:'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z',star:'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z'};
 return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]||paths.star}/></svg>
}

export default function Home(){
 const [cart,setCart]=useState<number[]>([]); const [active,setActive]=useState('all'); const [q,setQ]=useState(''); const [notice,setNotice]=useState('');
 const filtered=useMemo(()=>products.filter(p=>(active==='all'||p.cat===active)&&p.title.toLowerCase().includes(q.toLowerCase())),[active,q]);
 const add=(id:number)=>{setCart(c=>[...c,id]);setNotice('Товар добавлен в корзину');setTimeout(()=>setNotice(''),1800)};
 const scroll=(id:string)=>document.getElementById(id)?.scrollIntoView({behavior:'smooth'});
 return <main>
  {notice&&<div className="toast">✓ {notice}</div>}
  <header className="header">
   <div className="topbar wrap">
    <div className="brand" onClick={()=>scroll('home')}><div className="logo">⌂</div><div><b>Tech<span>Room</span></b><small>Техника. Запчасти. Идеи.</small></div></div>
    <div className="search"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Поиск товаров, брендов, категорий..."/><Icon name="search"/></div>
    <div className="actions"><button><Icon name="heart"/> Избранное</button><button onClick={()=>scroll('cart')}><Icon name="cart"/> Корзина <i>{cart.length}</i></button><button><Icon name="user"/> Войти / Регистрация</button></div>
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
   <div className="products">{filtered.map(p=><article className="product" key={p.id}><div className="pic">{p.badge&&<span className="badge">{p.badge}</span>}<button className="fav"><Icon name="heart"/></button><div className="product-art">{p.emoji}</div></div><small>{p.cat}</small><h3>{p.title}</h3><div className="rating"><span>★ {p.rating}</span> ({p.reviews}) <em>● В наличии</em></div><strong>{money(p.price)}</strong><button className="buy" onClick={()=>add(p.id)}><Icon name="cart"/> В корзину</button></article>)}</div>
   {!filtered.length&&<div className="empty">Ничего не нашли. Попробуйте изменить запрос или категорию.</div>}
  </section>

  <section id="offers" className="offers"><div className="wrap"><div className="section-head"><div><h2>Акции и спецпредложения</h2><p>Выгодные предложения в каждой комнате</p></div><button className="link">Все акции →</button></div><div className="offer-grid">{[['Автозапчасти','Скидки до 30%','На популярные запчасти','auto'],['Электроника','Скидки до 20%','На технику и аксессуары','electronics'],['Гаджеты','Лучшие цены на хиты','На популярные гаджеты','gadgets'],['3D-печать','Скидка 15% на пластик','На расходные материалы','print']].map((o,i)=><div className={'offer '+o[3]} key={i}><small>{o[0]}</small><b>{o[1]}</b><span>{o[2]}</span><button>Перейти →</button></div>)}</div></div></section>

  <section id="cart" className="cart-band"><div className="wrap cart-row"><div><b>Корзина</b><span>{cart.length?` ${cart.length} товар(ов) добавлено`:' пока пуста'}</span></div><button onClick={()=>{setNotice(cart.length?'Переходим к оформлению заказа':'Добавьте товар в корзину');}}>Оформить заказ →</button></div></section>

  <footer><div className="wrap footer-grid"><div className="brand"><div className="logo">⌂</div><div><b>Tech<span>Room</span></b><small>Техника. Запчасти. Идеи.</small></div></div><div><h4>Каталог</h4><a>Автозапчасти</a><a>Электроника</a><a>Гаджеты</a><a>3D-печать</a></div><div><h4>Информация</h4><a>О магазине</a><a>Доставка и оплата</a><a>Гарантия</a><a>Контакты</a></div><div><h4>Мы в соцсетях</h4><div className="social">VK　TG　▶　◎</div></div><div><h4>Будьте в курсе новинок и акций</h4><div className="subscribe"><input placeholder="Ваш email"/><button>Подписаться</button></div></div></div><div className="wrap copyright">© 2026 TechRoom. Все права защищены. <span>Политика конфиденциальности　 Пользовательское соглашение</span></div></footer>
 </main>
}
