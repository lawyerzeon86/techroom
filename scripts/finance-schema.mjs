#!/usr/bin/env node
import pg from 'pg';
const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}});
try{
 const oz=await pool.query("SELECT payload FROM marketplace_finance_pages WHERE source='ozon' ORDER BY month,page");
 const rows=oz.rows.flatMap(r=>Array.isArray(r.payload)?r.payload:[]);
 const p=rows.find(x=>x?.posting?.products?.length)?.posting.products[0];
 const feeRow=rows.find(x=>Array.isArray(x?.item_fees)&&x.item_fees.length);
 const out={
  categories:[...new Set(rows.map(x=>String(x.accrued_category||'unknown')))].sort(),
  productKeys:p?Object.keys(p).sort():[],
  commissionKeys:p?.commission?Object.keys(p.commission).sort():[],
  deliveryKeys:p?.delivery?Object.keys(p.delivery).sort():[],
  itemFeeKeys:feeRow?.item_fees?.[0]?Object.keys(feeRow.item_fees[0]).sort():[],
  itemFeeNestedKeys:feeRow?.item_fees?.[0]?.fees?.[0]?Object.keys(feeRow.item_fees[0].fees[0]).sort():[],
  nonItemFeeKeys:rows.find(x=>x?.non_item_fee)?.non_item_fee?Object.keys(rows.find(x=>x?.non_item_fee).non_item_fee).sort():[]
 };
 console.log(JSON.stringify(out));
}finally{await pool.end();}
