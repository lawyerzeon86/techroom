type OzonRequestOptions = { method?: "GET" | "POST"; body?: unknown; };
const OZON_API_BASE = "https://api-seller.ozon.ru";
function credentials(){const clientId=process.env.OZON_CLIENT_ID;const apiKey=process.env.OZON_API_KEY;if(!clientId||!apiKey)throw new Error("OZON_NOT_CONFIGURED");return{clientId,apiKey};}
export function isOzonConfigured(){return Boolean(process.env.OZON_CLIENT_ID&&process.env.OZON_API_KEY);}
export async function ozonRequest<T>(path:string,options:OzonRequestOptions={}):Promise<T>{const{clientId,apiKey}=credentials();const response=await fetch(`${OZON_API_BASE}${path}`,{method:options.method??"POST",headers:{"Client-Id":clientId,"Api-Key":apiKey,"Content-Type":"application/json"},body:options.body===undefined?undefined:JSON.stringify(options.body),cache:"no-store"});if(!response.ok){const detail=await response.text();throw new Error(`OZON_API_${response.status}: ${detail.slice(0,500)}`);}return response.json() as Promise<T>;}
export async function getOzonAccrualsByDay(date:string,lastId=""){return ozonRequest<any>("/v1/finance/accrual/by-day",{body:{date,last_id:lastId}});}
export async function getOzonAccrualTypes(){return ozonRequest<any>("/v1/finance/accrual/types",{body:{}});}
