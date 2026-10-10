#!/usr/bin/env node
// production currency audit v2
import pg from 'pg';
const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}});
const interesting=/currency|валют|iso.?code/i;
const values=new Map();
function walk(v,path='',depth=0){
 if(depth>8||v==null)return;
 if(Array.isArray(v)){for(const x of v.slice(0,200))walk(x,path+'[]',depth+1);return}
 if(typeof v!=='object')return;
 for(const [k,x] of Object.entries(v)){
   const p=path?path+'.'+k:k;
   if(interesting.test(k)){
     const s=typeof x==='string'||typeof x==='number'?String(x):JSON.stringify(x);
     if(s&&s.length<120){
       if(!values.has(p))values.set(p,new Set());
       values.get(p).add(s);
     }
   }
   if(typeof x==='object'&&x!==null)walk(x,p,depth+1);
 }
}
try{
 const q=await pool.query("select source,payload from marketplace_finance_pages order by fetched_at desc limit 1000");
 for(const row of q.rows)walk(row.payload,row.source);
 for(const [k,set] of [...values.entries()].sort(([a],[b])=>a.localeCompare(b))){
   console.log(k+'='+[...set].slice(0,25).join(','));
 }
}finally{await pool.end()}
