import { createHmac,timingSafeEqual } from 'node:crypto';
import { ensureSchema,getPool } from './db';

function env(name:string){const v=process.env[name]?.trim();if(!v)throw new Error(`${name}_NOT_CONFIGURED`);return v}
function graphVersion(){return process.env.WHATSAPP_GRAPH_VERSION?.trim()||'v23.0'}
export function normalizeWhatsAppPhone(value:string){return String(value||'').replace(/\D/g,'').slice(0,20)}

export function whatsappStatus(){return {
  configured:Boolean(process.env.WHATSAPP_ACCESS_TOKEN?.trim()&&process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()&&process.env.WHATSAPP_VERIFY_TOKEN?.trim()&&process.env.WHATSAPP_APP_SECRET?.trim()),
  phoneNumberIdConfigured:Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()),
  webhookSecretConfigured:Boolean(process.env.WHATSAPP_APP_SECRET?.trim()),
  graphVersion:graphVersion(),
}}

export async function ensureWhatsAppSchema(){
  await ensureSchema();const pool=getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS whatsapp_contacts(
    id BIGSERIAL PRIMARY KEY,phone TEXT NOT NULL UNIQUE,profile_name TEXT,wa_id TEXT,last_message_at TIMESTAMPTZ,
    unread_count INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS whatsapp_messages(
    id BIGSERIAL PRIMARY KEY,wa_message_id TEXT UNIQUE,phone TEXT NOT NULL,direction TEXT NOT NULL CHECK(direction IN ('in','out')),
    message_type TEXT NOT NULL DEFAULT 'text',text TEXT,status TEXT,reply_to_message_id TEXT,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone_created ON whatsapp_messages(phone,created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_last ON whatsapp_contacts(last_message_at DESC NULLS LAST)`);
}

export function verifyWhatsAppSignature(raw:string,header:string|null){
  const secret=process.env.WHATSAPP_APP_SECRET?.trim();if(!secret||!header?.startsWith('sha256='))return false;
  const expected=createHmac('sha256',secret).update(raw).digest();const supplied=Buffer.from(header.slice(7),'hex');
  return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}

function messageText(m:any){
  if(m?.type==='text')return String(m?.text?.body||'');
  if(m?.type==='button')return String(m?.button?.text||m?.button?.payload||'');
  if(m?.type==='interactive')return String(m?.interactive?.button_reply?.title||m?.interactive?.list_reply?.title||'');
  if(m?.type==='image')return String(m?.image?.caption||'[Изображение]');
  if(m?.type==='document')return String(m?.document?.caption||m?.document?.filename||'[Документ]');
  if(m?.type==='audio')return '[Аудио]';if(m?.type==='video')return String(m?.video?.caption||'[Видео]');
  if(m?.type==='location')return `[Геолокация] ${m?.location?.latitude??''}, ${m?.location?.longitude??''}`;
  return `[${String(m?.type||'сообщение')}]`;
}

export async function processWhatsAppWebhook(payload:any){
  await ensureWhatsAppSchema();const pool=getPool();let messages=0,statuses=0;
  for(const entry of Array.isArray(payload?.entry)?payload.entry:[]){for(const change of Array.isArray(entry?.changes)?entry.changes:[]){
    const value=change?.value||{};const names=new Map<string,string>();
    for(const c of Array.isArray(value?.contacts)?value.contacts:[]){const p=normalizeWhatsAppPhone(c?.wa_id||'');if(p)names.set(p,String(c?.profile?.name||''))}
    for(const m of Array.isArray(value?.messages)?value.messages:[]){
      const phone=normalizeWhatsAppPhone(m?.from||'');if(!phone)continue;const created=m?.timestamp?new Date(Number(m.timestamp)*1000):new Date();
      await pool.query(`INSERT INTO whatsapp_contacts(phone,profile_name,wa_id,last_message_at,unread_count,updated_at)
        VALUES($1,$2,$1,$3,1,NOW()) ON CONFLICT(phone) DO UPDATE SET profile_name=COALESCE(NULLIF(EXCLUDED.profile_name,''),whatsapp_contacts.profile_name),last_message_at=EXCLUDED.last_message_at,unread_count=whatsapp_contacts.unread_count+1,updated_at=NOW()`,[phone,names.get(phone)||null,created]);
      await pool.query(`INSERT INTO whatsapp_messages(wa_message_id,phone,direction,message_type,text,status,reply_to_message_id,raw_payload,created_at)
        VALUES($1,$2,'in',$3,$4,'received',$5,$6::jsonb,$7) ON CONFLICT(wa_message_id) DO NOTHING`,[String(m?.id||''),phone,String(m?.type||'text'),messageText(m),m?.context?.id?String(m.context.id):null,JSON.stringify(m),created]);messages++;
    }
    for(const s of Array.isArray(value?.statuses)?value.statuses:[]){if(!s?.id)continue;await pool.query(`UPDATE whatsapp_messages SET status=$2,updated_at=NOW() WHERE wa_message_id=$1`,[String(s.id),String(s.status||'unknown')]);statuses++}
  }}return {messages,statuses};
}

async function graphSend(body:any){
  const token=env('WHATSAPP_ACCESS_TOKEN'),id=env('WHATSAPP_PHONE_NUMBER_ID');
  const r=await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(id)}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',...body}),cache:'no-store'});
  const text=await r.text();let data:any={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}}if(!r.ok)throw new Error(String(data?.error?.message||`WHATSAPP_HTTP_${r.status}`));return data;
}

export async function sendWhatsAppMessage(to:string,text:string,buttonUrl?:string){
  const phone=normalizeWhatsAppPhone(to),clean=String(text||'').trim();if(phone.length<7)throw new Error('INVALID_PHONE');if(!clean||clean.length>4096)throw new Error('INVALID_MESSAGE');
  await ensureWhatsAppSchema();const body=buttonUrl?{to:phone,type:'interactive',interactive:{type:'cta_url',body:{text:clean},action:{name:'cta_url',parameters:{display_text:'Открыть Duisun',url:buttonUrl}}}}:{to:phone,type:'text',text:{body:clean,preview_url:false}};
  const data=await graphSend(body);const messageId=String(data?.messages?.[0]?.id||'');const pool=getPool();
  await pool.query(`INSERT INTO whatsapp_contacts(phone,wa_id,last_message_at,updated_at) VALUES($1,$1,NOW(),NOW()) ON CONFLICT(phone) DO UPDATE SET last_message_at=NOW(),updated_at=NOW()`,[phone]);
  await pool.query(`INSERT INTO whatsapp_messages(wa_message_id,phone,direction,message_type,text,status,raw_payload) VALUES($1,$2,'out',$3,$4,'sent',$5::jsonb) ON CONFLICT(wa_message_id) DO NOTHING`,[messageId||null,phone,buttonUrl?'interactive':'text',clean,JSON.stringify(data)]);
  return {ok:true,id:messageId,data};
}

export async function sendWhatsAppTemplate(to:string,name:string,language='ru',components:any[]=[]){
  const phone=normalizeWhatsAppPhone(to);if(phone.length<7)throw new Error('INVALID_PHONE');return graphSend({to:phone,type:'template',template:{name,language:{code:language},components}});
}

export async function listWhatsAppThreads(limit=100){
  await ensureWhatsAppSchema();const pool=getPool();const {rows}=await pool.query(`SELECT c.phone,c.profile_name,c.last_message_at,c.unread_count,
    (SELECT text FROM whatsapp_messages m WHERE m.phone=c.phone ORDER BY m.created_at DESC LIMIT 1) last_text,
    (SELECT id FROM orders o WHERE regexp_replace(COALESCE(o.whatsapp_phone,o.phone,''),'\\D','','g')=c.phone ORDER BY o.created_at DESC LIMIT 1) order_id
    FROM whatsapp_contacts c ORDER BY c.last_message_at DESC NULLS LAST LIMIT $1`,[Math.max(1,Math.min(200,limit))]);return rows;
}

export async function listWhatsAppMessages(phoneRaw:string,limit=200){
  await ensureWhatsAppSchema();const phone=normalizeWhatsAppPhone(phoneRaw);const pool=getPool();
  const {rows}=await pool.query(`SELECT id,wa_message_id,phone,direction,message_type,text,status,created_at FROM whatsapp_messages WHERE phone=$1 ORDER BY created_at ASC LIMIT $2`,[phone,Math.max(1,Math.min(500,limit))]);
  await pool.query(`UPDATE whatsapp_contacts SET unread_count=0 WHERE phone=$1`,[phone]);return rows;
}
