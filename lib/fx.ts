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
