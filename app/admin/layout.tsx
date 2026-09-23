import type { ReactNode } from 'react';

export default function AdminLayout({children}:{children:ReactNode}){
  return <>
    <div style={{position:'sticky',top:0,zIndex:60,background:'#231f1b',color:'#fff',borderBottom:'1px solid #3b342e'}}>
      <div style={{width:'min(1280px,calc(100% - 32px))',margin:'0 auto',height:50,display:'flex',alignItems:'center',gap:18,overflowX:'auto'}}>
        <b style={{whiteSpace:'nowrap'}}>TechRoom Admin</b>
        <a href="/admin" style={{color:'#fff',textDecoration:'none',whiteSpace:'nowrap'}}>Товары</a>
        <a href="/admin/prices" style={{color:'#ffd27a',textDecoration:'none',whiteSpace:'nowrap'}}>Лист цен</a>
        <a href="/admin/orders" style={{color:'#fff',textDecoration:'none',whiteSpace:'nowrap'}}>Заказы</a>
        <a href="/admin/communications" style={{color:'#fff',textDecoration:'none',whiteSpace:'nowrap'}}>Отзывы и вопросы</a>
        <a href="/admin/marketplaces" style={{color:'#ffb07a',textDecoration:'none',whiteSpace:'nowrap'}}>AI Маркетплейсы</a>\n        <a href="/admin/ozon-finance" style={{color:'#ffd27a',textDecoration:'none',whiteSpace:'nowrap'}}>Ozon Финансы</a>
        <a href="/admin/integrations" style={{color:'#fff',textDecoration:'none',whiteSpace:'nowrap'}}>Интеграции</a>
        <a href="/" style={{color:'#ff9a55',textDecoration:'none',marginLeft:'auto',whiteSpace:'nowrap'}}>На сайт →</a>
      </div>
    </div>
    {children}
  </>;
}
