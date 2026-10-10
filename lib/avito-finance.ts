import { createHash } from 'node:crypto';
import { getPool } from './db';

function parseMoney(v:any){
  const s=String(v??'').trim().replace(/\s/g,'').replace(/,/g,'.').replace(/[^0-9.+-]/g,'');
  const n=Number(s);
  return Number.isFinite(n)?n:0;
}
function pick(obj:any,keys:string[]){
  for(const k of keys){
    const v=obj?.[k];
    if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;
  }
  return null;
}
function parseDate(v:any){
  const s=String(v??'').trim();
  const iso=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if(iso)return iso[1]+'-'+String(iso[2]).padStart(2,'0')+'-'+String(iso[3]).padStart(2,'0');
  const ru=s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if(ru)return ru[3]+'-'+String(ru[2]).padStart(2,'0')+'-'+String(ru[1]).padStart(2,'0');
  const d=new Date(s);
  return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):null;
}
function currency(v:any){
  const s=String(v??'RUB').trim().toUpperCase();
  const a:Record<string,string>={'₽':'RUB','РУБ':'RUB','RUR':'RUB','₸':'KZT','ТЕНГЕ':'KZT','$':'USD','€':'EUR','¥':'CNY','RMB':'CNY'};
  return a[s]||(/^[A-Z]{3}$/.test(s)?s:'RUB');
}
export function parseDelimited(text:string){
  const first=(text.split(/\r?\n/).find(x=>x.trim())||'');
  const candidates=[';','\t',','];
  const delimiter=candidates.sort((a,b)=>(first.split(b).length-first.split(a).length))[0];
  const rows:string[][]=[];
  let row:string[]=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){
      if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted;
    }else if(ch===delimiter&&!quoted){row.push(cell.trim());cell=''}
    else if((ch==='\n'||ch==='\r')&&!quoted){
      if(ch==='\r'&&text[i+1]==='\n')i++;
      row.push(cell.trim());cell='';
      if(row.some(Boolean))rows.push(row);
      row=[];
    }else cell+=ch;
  }
  if(cell||row.length){row.push(cell.trim());if(row.some(Boolean))rows.push(row)}
  if(rows.length<2)return [];
  const headers=rows[0].map(x=>x.trim());
  return rows.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
}
function getAny(obj:any,patterns:RegExp[]){
  for(const [k,v] of Object.entries(obj||{}))if(patterns.some(p=>p.test(k)))return v;
  return null;
}
export function normalizeAvitoRows(input:any[]){
  const out:any[]=[];
  for(const raw of input){
    if(!raw||typeof raw!=='object')continue;
    const date=parseDate(
      pick(raw,['date','orderDate','createdAt','created_at','Дата','Дата заказа','Дата операции']) ??
      getAny(raw,[/дата.*заказ/i,/дата.*операц/i,/^дата$/i,/created/i])
    );
    if(!date)continue;
    const amount=parseMoney(
      pick(raw,['amount','sales','price','gross','Сумма','Цена','Сумма заказа']) ??
      getAny(raw,[/сумма.*заказ/i,/стоим/i,/цена/i,/gross/i])
    );
    const net=parseMoney(
      pick(raw,['net','payout','payment','К выплате','Выплата','Зачислено']) ??
      getAny(raw,[/к.*выплат/i,/выплат/i,/зачисл/i,/получено/i])
    ) || amount;
    const qty=Math.max(1,Math.abs(Number(
      pick(raw,['quantity','qty','Количество']) ??
      getAny(raw,[/колич/i,/qty/i])
    )||1));
    const cur=currency(
      pick(raw,['currency','currency_code','Валюта']) ??
      getAny(raw,[/валют/i])
    );
    const status=String(
      pick(raw,['status','state','Статус']) ??
      getAny(raw,[/статус/i]) ?? ''
    ).trim();
    const sku=String(
      pick(raw,['sku','article','Артикул']) ??
      getAny(raw,[/артик/i,/sku/i]) ?? ''
    ).trim();
    const title=String(
      pick(raw,['title','item','Товар','Название']) ??
      getAny(raw,[/товар/i,/назван/i]) ?? ''
    ).trim();
    const orderId=String(
      pick(raw,['orderId','order_id','id','Номер заказа','Заказ']) ??
      getAny(raw,[/номер.*заказ/i,/^заказ$/i,/order.*id/i]) ?? ''
    ).trim();
    const itemId=String(
      pick(raw,['itemId','item_id','Avito ID','ID объявления']) ??
      getAny(raw,[/id.*объяв/i,/avito.*id/i]) ?? ''
    ).trim();
    const row:any={date,amount,net,quantity:qty,currency:cur,status,sku,title,orderId,itemId,source:'avito_browser'};
    row.fingerprint=createHash('sha256').update(JSON.stringify([date,amount,net,qty,cur,status,sku,title,orderId,itemId])).digest('hex');
    out.push(row);
  }
  return out;
}
export async function importAvitoFinanceRows(rows:any[]){
  const normalized=normalizeAvitoRows(rows);
  if(!normalized.length)throw new Error('AVITO_NO_VALID_ROWS');
  const pool=getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketplace_finance_pages(
      source TEXT NOT NULL,month CHAR(7) NOT NULL,page INTEGER NOT NULL,payload JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(source,month,page)
    )
  `);
  const byMonth=new Map<string,any[]>();
  for(const x of normalized){
    const m=x.date.slice(0,7);
    if(!byMonth.has(m))byMonth.set(m,[]);
    byMonth.get(m)!.push(x);
  }
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    let imported=0,months=0;
    for(const [month,incoming] of byMonth){
      const existing=await client.query("SELECT payload FROM marketplace_finance_pages WHERE source='avito' AND btrim(month)=$1 ORDER BY page",[month]);
      const merged=new Map<string,any>();
      for(const q of existing.rows)for(const x of (Array.isArray(q.payload)?q.payload:[])){
        const fp=String(x.fingerprint||createHash('sha256').update(JSON.stringify([x.date,x.amount,x.net,x.quantity,x.currency,x.status,x.sku,x.title,x.orderId,x.itemId])).digest('hex'));
        merged.set(fp,x);
      }
      for(const x of incoming)merged.set(x.fingerprint,x);
      await client.query("DELETE FROM marketplace_finance_pages WHERE source='avito' AND btrim(month)=$1",[month]);
      const values=[...merged.values()];
      for(let i=0,page=0;i<values.length;i+=5000,page++){
        await client.query("INSERT INTO marketplace_finance_pages(source,month,page,payload,fetched_at) VALUES('avito',$1,$2,$3::jsonb,NOW())",[month,page,JSON.stringify(values.slice(i,i+5000))]);
      }
      imported+=incoming.length;months++;
    }
    await client.query('COMMIT');
    return {ok:true,received:rows.length,valid:normalized.length,imported,months:[...byMonth.keys()].sort()};
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
