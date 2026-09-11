'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import styles from './product.module.css';

type Product = {
  id:number;
  category:string;
  title:string;
  price:number;
  oldPrice?:number|null;
  rating:number;
  reviews:number;
  badge?:string|null;
  emoji?:string|null;
  imageUrl?:string|null;
  imageUrls?:string[];
  sku?:string|null;
  oem?:string|null;
  stock:number;
  description?:string|null;
  specs?:string|null;
  isActive:boolean;
  sortOrder:number;
};

const money=(n:number)=>new Intl.NumberFormat('ru-RU').format(n)+' ₽';

export default function ProductPage(){
  const params = useParams<{id:string}>();
  const router = useRouter();
  const [product,setProduct]=useState<Product|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [activeImage,setActiveImage]=useState(0);
  const [notice,setNotice]=useState('');

  useEffect(()=>{
    let alive=true;
    setLoading(true);
    setError('');
    fetch('/api/products',{cache:'no-store'})
      .then(async r=>{
        if(!r.ok) throw new Error('LOAD_FAILED');
        return r.json();
      })
      .then((items:Product[])=>{
        if(!alive) return;
        const found=items.find(p=>String(p.id)===String(params.id));
        if(!found){setError('Товар не найден');setProduct(null);return;}
        setProduct(found);
        setActiveImage(0);
      })
      .catch(()=>alive&&setError('Не удалось загрузить товар'))
      .finally(()=>alive&&setLoading(false));
    return ()=>{alive=false};
  },[params.id]);

  const images = useMemo(()=>{
    if(!product) return [];
    const arr=(product.imageUrls?.length?product.imageUrls:(product.imageUrl?[product.imageUrl]:[]))
      .filter(Boolean) as string[];
    return [...new Set(arr)];
  },[product]);

  const specs = useMemo(()=>{
    if(!product?.specs) return [];
    return product.specs.split('\n').map(s=>s.trim()).filter(Boolean).map(row=>{
      const i=row.indexOf(':');
      return i>0 ? [row.slice(0,i).trim(),row.slice(i+1).trim()] : ['Характеристика',row];
    });
  },[product]);

  if(loading) return <main className={styles.page}><div className={styles.card}><p>Загрузка товара…</p></div></main>;

  if(error || !product) return (
    <main className={styles.page}>
      <div className={styles.card}>
        <button className={styles.back} onClick={()=>router.push('/')}>← В каталог</button>
        <h1>{error||'Товар не найден'}</h1>
      </div>
    </main>
  );

  const mainImage=images[activeImage]||images[0];

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <button className={styles.back} onClick={()=>router.push('/')}>← В каталог</button>

        <div className={styles.grid}>
          <section className={styles.gallery}>
            <div className={styles.mainImage}>
              {mainImage
                ? <img src={mainImage} alt={product.title}/>
                : <div className={styles.emoji}>{product.emoji||'📦'}</div>}
              {product.badge && <span className={styles.badge}>{product.badge}</span>}
            </div>

            {images.length>1 && (
              <div className={styles.thumbs}>
                {images.map((url,i)=>(
                  <button
                    key={url}
                    onClick={()=>setActiveImage(i)}
                    className={`${styles.thumb} ${i===activeImage?styles.thumbActive:''}`}
                    aria-label={`Показать фото ${i+1}`}
                  >
                    <img src={url} alt={`${product.title} — фото ${i+1}`}/>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className={styles.info}>
            <div className={styles.category}>{product.category}</div>
            <h1>{product.title}</h1>
            <div className={styles.meta}>
              <span>★ {product.rating}</span>
              <span>{product.reviews} отзывов</span>
            </div>

            <div className={styles.price}>
              <strong>{money(product.price)}</strong>
              {product.oldPrice && product.oldPrice>product.price && <del>{money(product.oldPrice)}</del>}
            </div>

            <div className={`${styles.stock} ${product.stock>0?styles.in:styles.out}`}>
              {product.stock>0?`● В наличии: ${product.stock} шт.`:'○ Нет в наличии'}
            </div>

            {(product.sku || product.oem) && (
              <div className={styles.codes}>
                {product.sku && <div><b>Артикул / SKU:</b> {product.sku}</div>}
                {product.oem && <div><b>OEM:</b> {product.oem}</div>}
              </div>
            )}

            {product.description && (
              <div className={styles.description}>
                <h2>Описание</h2>
                <p>{product.description}</p>
              </div>
            )}

            <button
              className={styles.buy}
              disabled={product.stock<=0}
              onClick={()=>{
                setNotice('Товар добавлен в корзину');
                setTimeout(()=>setNotice(''),1800);
              }}
            >
              {product.stock>0?'В корзину':'Нет в наличии'}
            </button>
          </section>
        </div>

        {specs.length>0 && (
          <section className={styles.specs}>
            <h2>Характеристики</h2>
            <div className={styles.specList}>
              {specs.map(([k,v],i)=><div className={styles.specRow} key={i}><span>{k}</span><b>{v}</b></div>)}
            </div>
          </section>
        )}
      </div>

      {notice && <div className={styles.toast}>✓ {notice}</div>}
    </main>
  );
}
