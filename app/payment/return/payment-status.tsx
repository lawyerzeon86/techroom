'use client';

import { useEffect, useState } from 'react';
import styles from './return.module.css';

type State = { orderNumber:string; totalAmount:number; status:string; paymentStatus:string; paymentUrl?:string };
const money=(n:number)=>new Intl.NumberFormat('ru-RU').format(n)+' ₽';

export default function PaymentStatus({order,token}:{order:string;token:string}){
  const [state,setState]=useState<State|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let stopped=false;
    const check=async()=>{
      try{
        const r=await fetch(`/api/payments/status?order=${encodeURIComponent(order)}&token=${encodeURIComponent(token)}`,{cache:'no-store'});
        const j=await r.json();
        if(!r.ok)throw new Error(j.error||'Не удалось проверить оплату');
        if(!stopped){setState(j);setError('')}
        if(!stopped&&!['succeeded','canceled'].includes(j.paymentStatus))setTimeout(check,3000);
      }catch(e:any){if(!stopped)setError(e.message||'Не удалось проверить оплату')}
    };
    void check();
    return()=>{stopped=true};
  },[order,token]);

  const paid=state?.paymentStatus==='succeeded'||state?.status==='paid';
  const canceled=state?.paymentStatus==='canceled'||state?.status==='payment_canceled';
  return <main className={styles.page}><section className={styles.card}>
    <h1>{paid?'Оплата получена ✓':canceled?'Платёж отменён':'Проверяем оплату…'}</h1>
    {state&&<><div className={styles.order}>{state.orderNumber}</div><p>Сумма: <b>{money(state.totalAmount)}</b></p></>}
    {!paid&&!canceled&&!error&&<p>Обычно подтверждение СБП занимает несколько секунд. Страница обновится автоматически.</p>}
    {canceled&&<p>Деньги не списаны. Свяжитесь с менеджером, чтобы повторить оплату или выбрать другой способ.</p>}
    {error&&<p className={styles.error}>{error}</p>}
    {!paid&&!canceled&&state?.paymentUrl&&<a className={styles.primary} href={state.paymentUrl}>Вернуться к оплате</a>}
    <a className={styles.secondary} href="/">В каталог</a>
  </section></main>;
}
