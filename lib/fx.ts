import { getPool } from './db';

export type FxQuality={
  source:string;
  currencies:string[];
  convertedRecords:number;
  assumedRubRecords:number;
  missingRates:string[];
  approximateRates:boolean;
};

type RatePoint={date:string;rate:number};
export type FxBook={
  byCurrency:Map<string,RatePoint[]>;
  quality:FxQuality;
};

export function normalizeCurrency(value:any){
  const raw=String(value??'').trim().toUpperCase();
  if(!raw)return '';
  const aliases:Record<string,string>={
    'RUR':'RUB','643':'RUB','₽':'RUB','РУБ':'RUB','РУБ.':'RUB','RUBLES':'RUB',
    '398':'KZT','₸':'KZT','ТЕНГЕ':'KZT',
    '156':'CNY','¥':'CNY','ЮАНЬ':'CNY','RMB':'CNY',
    '840':'USD','$':'USD',
    '978':'EUR','€':'EUR',
    '826':'GBP','£':'GBP',
    '417':'KGS','СОМ':'KGS'
  };
  return aliases[raw]||(/^[A-Z]{3}$/.test(raw)?raw:'');
}

const currencyKeys=/^(currency|currency_?code|currency_?name|iso_?currency_?code|currency_?iso_?code|currencyCode|currencyName)$/i;
export function detectCurrency(value:any,fallback='RUB',depth=0):string{
  if(value==null||depth>4)return normalizeCurrency(fallback)||'RUB';
  if(typeof value!=='object')return normalizeCurrency(fallback)||'RUB';
  for(const [k,v] of Object.entries(value)){
    if(currencyKeys.test(k)){
      const c=normalizeCurrency(v);
      if(c)return c;
    }
  }
  for(const [k,v] of Object.entries(value)){
    if(v&&typeof v==='object'&&/(amount|price|commission|sale|payment|posting|operation|accrual)/i.test(k)){
      const c=detectCurrency(v,'',depth+1);
      if(c)return c;
    }
  }
  return normalizeCurrency(fallback)||'RUB';
}

export function detectDate(value:any,fallbackMonth:string){
  const keys=['date','saleDt','orderDt','rrDate','dateFrom','createDate','operation_date','accrual_date','posting_date','created_at'];
  for(const k of keys){
    const s=String(value?.[k]??'');
    const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m)return m[1]+'-'+m[2]+'-'+m[3];
  }
  return fallbackMonth+'-15';
}

export async function ensureFxSchema(){
  const pool=getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fx_rates(
      rate_date DATE NOT NULL,
      currency_code CHAR(3) NOT NULL,
      rate_to_rub NUMERIC(20,8) NOT NULL,
      nominal INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'CBR',
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(rate_date,currency_code)
    )
  `);
}

function parseCbrDate(raw:string,fallback:string){
  const m=String(raw||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m?`${m[3]}-${m[2]}-${m[1]}`:fallback;
}

async function fetchCbrRatesForDate(date:string){
  const [y,m,d]=date.split('-');
  const url=`https://www.cbr.ru/scripts/XML_daily.asp?date_req=${d}/${m}/${y}`;
  const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'User-Agent':'Duisun-Finance/1.0'}});
  if(!r.ok)throw new Error('CBR_HTTP_'+r.status);
  const xml=await r.text();
  const sourceDate=parseCbrDate(xml.match(/<ValCurs[^>]*Date="([^"]+)"/i)?.[1]||'',date);
  const rows:Array<{currency:string;rate:number;nominal:number}>=[];
  for(const block of xml.match(/<Valute\b[\s\S]*?<\/Valute>/gi)||[]){
    const code=normalizeCurrency(block.match(/<CharCode>([^<]+)<\/CharCode>/i)?.[1]||'');
    const nominal=Number((block.match(/<Nominal>([^<]+)<\/Nominal>/i)?.[1]||'1').replace(',','.'));
    const value=Number((block.match(/<Value>([^<]+)<\/Value>/i)?.[1]||'').replace(',','.'));
    if(code&&Number.isFinite(nominal)&&nominal>0&&Number.isFinite(value)&&value>0)rows.push({currency:code,rate:value/nominal,nominal});
  }
  if(!rows.length)throw new Error('CBR_EMPTY_RATES');
  const pool=getPool();
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    for(const x of rows){
      await client.query(`
        INSERT INTO fx_rates(rate_date,currency_code,rate_to_rub,nominal,source,fetched_at)
        VALUES($1,$2,$3,$4,'CBR',NOW())
        ON CONFLICT(rate_date,currency_code) DO UPDATE SET
          rate_to_rub=EXCLUDED.rate_to_rub,
          nominal=EXCLUDED.nominal,
          source='CBR',
          fetched_at=NOW()
      `,[date,x.currency,x.rate,x.nominal]);
    }
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  return {date,sourceDate,count:rows.length};
}

export async function ensureFxRates(items:Array<{currency:string;date:string}>){
  await ensureFxSchema();
  const need=new Map<string,Set<string>>();
  for(const item of items){
    const currency=normalizeCurrency(item.currency);
    const date=String(item.date||'').slice(0,10);
    if(!currency||currency==='RUB'||!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
    if(!need.has(date))need.set(date,new Set());
    need.get(date)!.add(currency);
  }
  if(!need.size)return {requestedDates:0,fetchedDates:0,errors:[] as string[]};

  const pool=getPool();
  const missing:string[]=[];
  for(const [date,currencies] of need){
    const q=await pool.query('SELECT btrim(currency_code) currency_code FROM fx_rates WHERE rate_date=$1',[date]);
    const have=new Set(q.rows.map((r:any)=>normalizeCurrency(r.currency_code)));
    if([...currencies].some(c=>!have.has(c)))missing.push(date);
  }

  const errors:string[]=[];
  let fetched=0;
  for(let i=0;i<missing.length;i+=4){
    const batch=missing.slice(i,i+4);
    const results=await Promise.allSettled(batch.map(fetchCbrRatesForDate));
    results.forEach((r,idx)=>{if(r.status==='fulfilled')fetched++;else errors.push(batch[idx]+':'+String(r.reason?.message||r.reason))});
  }
  return {requestedDates:need.size,fetchedDates:fetched,errors};
}

export async function loadFxBook(year:number):Promise<FxBook>{
  await ensureFxSchema();
  const pool=getPool();
  const q=await pool.query(`
    SELECT to_char(rate_date,'YYYY-MM-DD') rate_date,
           btrim(currency_code) currency_code,
           rate_to_rub
    FROM fx_rates
    WHERE rate_date >= ($1::date - interval '14 days')
      AND rate_date < ($1::date + interval '1 year' + interval '14 days')
    ORDER BY currency_code,rate_date
  `,[year+'-01-01']);
  const byCurrency=new Map<string,RatePoint[]>();
  byCurrency.set('RUB',[{date:year+'-01-01',rate:1}]);
  for(const r of q.rows){
    const c=normalizeCurrency(r.currency_code);
    const rate=Number(r.rate_to_rub);
    if(!c||!Number.isFinite(rate)||rate<=0)continue;
    if(!byCurrency.has(c))byCurrency.set(c,[]);
    byCurrency.get(c)!.push({date:String(r.rate_date),rate});
  }
  return {byCurrency,quality:{source:'CBR',currencies:['RUB'],convertedRecords:0,assumedRubRecords:0,missingRates:[],approximateRates:false}};
}

function rateFor(book:FxBook,currency:string,date:string){
  if(currency==='RUB')return {rate:1,approx:false};
  const list=book.byCurrency.get(currency)||[];
  if(!list.length)return null;
  let best:RatePoint|null=null;
  for(const p of list){if(p.date<=date)best=p;else break}
  if(best)return {rate:best.rate,approx:false};
  const nearest=list[0];
  return nearest?{rate:nearest.rate,approx:true}:null;
}

export function moneyToRub(book:FxBook,value:any,context:any,date:string,fallbackCurrency='RUB'){
  const amount=Number(value?.amount??value??0)||0;
  const explicit=detectCurrency(value,'')||detectCurrency(context,'');
  const currency=explicit||normalizeCurrency(fallbackCurrency)||'RUB';
  if(!explicit&&currency==='RUB')book.quality.assumedRubRecords++;
  if(!book.quality.currencies.includes(currency))book.quality.currencies.push(currency);
  const point=rateFor(book,currency,date);
  if(!point){
    const miss=currency+'@'+date;
    if(!book.quality.missingRates.includes(miss))book.quality.missingRates.push(miss);
    return 0;
  }
  if(currency!=='RUB')book.quality.convertedRecords++;
  if(point.approx)book.quality.approximateRates=true;
  return amount*point.rate;
}
