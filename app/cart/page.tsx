'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './cart.module.css';
import { CartEntry, clearCart, loadCart, removeFromCart, setCartQuantity } from '../../lib/cart-client';

type Product = {
  id:number; title:string; price:number; imageUrl?:string|null; emoji?:string|null;
  sku?:string|null; stock:number; isActive:boolean;
};

type OrderResult = { orderNumber:string; totalAmount:number; paymentMethod:string };
const money=(n:number)=>new Intl.NumberFormat('ru-RU').format(n)+' ₽';

export default function CartPage(){
  const router=useRouter();
  const [cart,setCart]=useState<CartEntry[]>([]);
  const [products,setProducts]=useState<Product[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [order,setOrder]=useState<OrderResult|null>(null);
  const [form,setForm]=useState({customerName:'',phone:'',email:'',deliveryMethod:'courier',address:'',paymentMethod:'qr',comment:''});

  useEffect(()=>{
    setCart(loadCart());
    fetch('/api/products',{cache:'no-store'})
      .then(async r=>{if(!r.ok) throw new Error(); return r.json()})
      .then(setProducts)
      .catch(()=>setMessage('Не удалось загрузить товары.'))
      .finally(()=>setLoading(false));
  },[]);

  const lines=useMemo(()=>cart.map(entry=>{
    const product=products.find(p=>p.id===entry.productId);
    return product?{...entry,product}:null;
  }).filter(Boolean) as {productId:number;quantity:number;product:Product}[],[cart,products]);

  const total=lines.reduce((sum,l)=>sum+l.product.price*l.quantity,0);
  const count=cart.reduce((sum,l)=>sum+l.quantity,0);

  const changeQty=(id:number,qty:number)=>setCart(setCartQuantity(id,qty));
  const remove=(id:number)=>setCart(removeFromCart(id));

  const submit=async()=>{
    setMessage('');
    if(!cart.length){setMessage('Корзина пуста.');return;}
    if(!form.customerName.trim()||!form.phone.trim()){setMessage('Укажите имя и телефон.');return;}
    if(form.deliveryMethod==='courier'&&!form.address.trim()){setMessage('Укажите адрес доставки.');return;}
    setBusy(true);
    try{
      const r=await fetch('/api/orders',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...form,items:cart})
      });
      const j=await r.json();
      if(!r.ok){setMessage(j.error||'Не удалось оформить заказ.');return;}
      setOrder(j);
      clearCart();
      setCart([]);
    }catch{
      setMessage('Ошибка соединения. Попробуйте ещё раз.');
    }finally{setBusy(false)}
  };

  if(order) return <main className={styles.page}><div className={styles.wrap}>
    <div className={styles.orderBox}>
      <h2>Заказ оформлен ✓</h2>
      <div className={styles.orderNo}>{order.orderNumber}</div>
      <p>Сумма заказа: <b>{money(order.totalAmount)}</b></p>
      {order.paymentMethod==='qr' && <div className={styles.qrHint}>Вы выбрали оплату по QR / СБП. Пока платёжный провайдер не подключён, заказ сохранён как новый — QR для оплаты добавим следующим этапом.</div>}
      <button className={styles.submit} onClick={()=>router.push('/')}>Вернуться в каталог</button>
    </div>
  </div></main>;

  return <main className={styles.page}><div className={styles.wrap}>
    <div className={styles.top}><div><button className={styles.back} onClick={()=>router.push('/')}>← В каталог</button><h1>Корзина</h1></div><b>{count} шт.</b></div>

    {loading ? <div className={styles.card}>Загрузка…</div> : !cart.length ? <div className={`${styles.card} ${styles.empty}`}><h2>Корзина пуста</h2><p>Добавьте товары из каталога.</p><button className={styles.submit} onClick={()=>router.push('/')}>Перейти к товарам</button></div> : <div className={styles.layout}>
      <section className={styles.card}>
        <div className={styles.items}>
          {lines.map(({product,quantity})=><div className={styles.item} key={product.id}>
            <div className={styles.image}>{product.imageUrl?<img src={product.imageUrl} alt={product.title}/>:product.emoji||'📦'}</div>
            <div><div className={styles.name}>{product.title}</div><div className={styles.meta}>{product.sku?`Артикул: ${product.sku}`:'TechRoom'} · {product.stock>0?`В наличии ${product.stock} шт.`:'Нет в наличии'}</div>
              <div className={styles.qty}><button onClick={()=>changeQty(product.id,quantity-1)}>−</button><span>{quantity}</span><button disabled={quantity>=product.stock} onClick={()=>changeQty(product.id,quantity+1)}>+</button></div>
            </div>
            <div className={styles.price}><strong>{money(product.price*quantity)}</strong><button className={styles.remove} onClick={()=>remove(product.id)}>Удалить</button></div>
          </div>)}
        </div>
      </section>

      <aside>
        <div className={`${styles.card} ${styles.summary}`}>
          <h2>Итого</h2><div className={styles.row}><span>Товары ({count})</span><b>{money(total)}</b></div><div className={styles.row}><span>Доставка</span><span>Рассчитывается после заказа</span></div><div className={styles.total}><span>К оплате</span><span>{money(total)}</span></div>
        </div>

        <div className={`${styles.card} ${styles.checkout}`}>
          <h2>Оформление</h2>
          <div className={styles.grid}>
            <label className={styles.field}><span>Имя *</span><input value={form.customerName} onChange={e=>setForm({...form,customerName:e.target.value})}/></label>
            <label className={styles.field}><span>Телефон *</span><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+7 ..."/></label>
            <label className={`${styles.field} ${styles.wide}`}><span>Email</span><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
            <div className={`${styles.field} ${styles.wide}`}><span>Доставка</span><div className={styles.radioGroup}>
              <label className={styles.radio}><input type="radio" checked={form.deliveryMethod==='courier'} onChange={()=>setForm({...form,deliveryMethod:'courier'})}/><span><b>Курьер / транспортная компания</b><br/>Адрес уточняется при обработке заказа</span></label>
              <label className={styles.radio}><input type="radio" checked={form.deliveryMethod==='pickup'} onChange={()=>setForm({...form,deliveryMethod:'pickup',address:''})}/><span><b>Самовывоз</b><br/>Менеджер сообщит адрес и время</span></label>
            </div></div>
            {form.deliveryMethod==='courier'&&<label className={`${styles.field} ${styles.wide}`}><span>Адрес доставки *</span><input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label>}
            <div className={`${styles.field} ${styles.wide}`}><span>Оплата</span><div className={styles.radioGroup}>
              <label className={styles.radio}><input type="radio" checked={form.paymentMethod==='qr'} onChange={()=>setForm({...form,paymentMethod:'qr'})}/><span><b>QR / СБП</b><br/>После подключения платёжного провайдера QR появится автоматически</span></label>
              <label className={styles.radio}><input type="radio" checked={form.paymentMethod==='cash'} onChange={()=>setForm({...form,paymentMethod:'cash'})}/><span><b>При получении</b><br/>Если доступно для выбранного способа доставки</span></label>
            </div></div>
            <label className={`${styles.field} ${styles.wide}`}><span>Комментарий</span><textarea value={form.comment} onChange={e=>setForm({...form,comment:e.target.value})}/></label>
          </div>
          {message&&<div className={styles.notice}>{message}</div>}
          <button className={styles.submit} disabled={busy||!lines.length} onClick={submit}>{busy?'Оформляем…':'Оформить заказ'}</button>
        </div>
      </aside>
    </div>}
  </div></main>;
}
