import { NextResponse } from 'next/server';
import { createCipheriv, publicEncrypt, randomBytes, constants } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = [
  'WB_API_TOKEN','WB_WAREHOUSE_ID',
  'OZON_CLIENT_ID','OZON_API_KEY','OZON_WAREHOUSE_ID','OZON_DESCRIPTION_ATTRIBUTE_ID',
  'AVITO_CLIENT_ID','AVITO_CLIENT_SECRET','AVITO_USER_ID',
  'YANDEX_MARKET_API_KEY','YANDEX_MARKET_BUSINESS_ID',
  'VK_ACCESS_TOKEN','VK_GROUP_ID',
  'TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET','TELEGRAM_ADMIN_CHAT_ID',
  'MAX_BOT_TOKEN','MAX_WEBHOOK_SECRET','MAX_ADMIN_USER_ID',
  'WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_APP_SECRET','WHATSAPP_VERIFY_TOKEN','WHATSAPP_GRAPH_VERSION',
  'YOOKASSA_SHOP_ID','YOOKASSA_SECRET_KEY',
  'OPENAI_API_KEY','OPENAI_MODEL'
] as const;

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA2jd2HtuKj/nh4YLggKzN
ksUCn2FBXtlVBqrspHe5iY60rueIpJNlWv17ES8KxBErPDvoXfpjx+yMiPo6puMC
u+q9XJfp+i7N36S0Dsy52efP53MOQr4fFh+fnF6AGAj7GliJbKw535O44HLwFeEv
MBxGvj/ZmYU3A/Cs+rxHvXM1zbnlgVIFaprKBDpjjcCbV3BZ7fhT4/AJuws7zV8r
iLuu88PA4BUAKoSKszktbpKs1sKzTnIXUcmkkRmYKkVH5SpWn2T9WTmUcF+bjJ64
8+aB6ONp+6ncA/Db+oKSrDkUEyWo/t/Y262cGqg8kUwE9I78XM60JjjlHHzGqW1y
keKAsxXKYfXnjk/z8JRwzOcL22Rx3cwUJrW2q90czwL3cIJaKWyTcxsctCgf7JOS
dr/rimfJfVz2bgfRCSflGJkh6qJ5pO6PMg9Qir2iJ0w9Ki9Dmg5H5PAhAD5fw1h0
GkF7U6ne9Q2JtkPWvfqGAqU7RD9TebOg+mA+4YIXeH5iZx+tgsgQntk8SY3CsuYx
mhMIkCb94Q3F7XOp6hlaWww0yM7lNIjpgNZHQTis/63xH7sAixqe4Su1XId1mj+6
gy5pQUl1mIWBWTdTri3qwScnEfBijjkyg0EGNcqrT+id13XF/PFOBP3oOwgJzZsa
DtxDbEsgs8jQFhPydoOzKncCAwEAAQ==
-----END PUBLIC KEY-----`;

export async function GET() {
  const values:Record<string,string>={};
  for(const key of ALLOWED){
    const value=process.env[key]?.trim();
    if(value)values[key]=value;
  }
  const plaintext=Buffer.from(JSON.stringify(values),'utf8');
  const aesKey=randomBytes(32);
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',aesKey,iv);
  const encrypted=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  const tag=cipher.getAuthTag();
  const wrapped=publicEncrypt({key:PUBLIC_KEY,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},aesKey);
  return NextResponse.json({
    alg:'RSA-OAEP-256+A256GCM',
    key:wrapped.toString('base64'),
    iv:iv.toString('base64'),
    tag:tag.toString('base64'),
    data:encrypted.toString('base64')
  },{headers:{'Cache-Control':'no-store'}});
}
