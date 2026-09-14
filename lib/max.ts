import { createHmac, timingSafeEqual } from 'node:crypto';

export type MaxUser={id:number;first_name?:string;last_name?:string;username?:string};
export function verifyMaxInitData(raw:string|null,maxAgeSeconds=86400):MaxUser|null{
 const token=process.env.MAX_BOT_TOKEN;if(!token||!raw||raw.length>8192)return null;
 const pairs=raw.split('&').map(x=>{const i=x.indexOf('=');return i<0?[x,'']:[x.slice(0,i),x.slice(i+1)]});
 if(pairs.filter(x=>x[0]==='hash').length!==1)return null;const hash=decodeURIComponent(pairs.find(x=>x[0]==='hash')![1]);if(!/^[a-f\d]{64}$/i.test(hash))return null;
 const data=pairs.filter(x=>x[0]!=='hash').map(([k,v])=>[k,decodeURIComponent(v)]).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 const key=createHmac('sha256','WebAppData').update(token).digest();const expected=createHmac('sha256',key).update(data).digest();const supplied=Buffer.from(hash,'hex');if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return null;
 const params=new URLSearchParams(raw),auth=Number(params.get('auth_date')),now=Math.floor(Date.now()/1000);if(!Number.isSafeInteger(auth)||auth>now+60||now-auth>maxAgeSeconds)return null;
 try{const u=JSON.parse(params.get('user')||'null');return u&&Number.isSafeInteger(u.id)&&u.id>0?u:null}catch{return null}
}
export function maxUserFromRequest(r:Request){return verifyMaxInitData(r.headers.get('x-max-init-data'))}
export async function sendMaxMessage(userId:number|string,text:string,url?:string){const token=process.env.MAX_BOT_TOKEN;if(!token)return false;const attachments=url?[{type:'inline_keyboard',payload:{buttons:[[{type:'link',text:'🛍 Открыть магазин',url}]]}}]:undefined;const r=await fetch(`https://platform-api2.max.ru/messages?user_id=${encodeURIComponent(String(userId))}`,{method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({text,attachments})});return r.ok}
