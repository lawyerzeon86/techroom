import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { isAdminSession, rateLimit } from '../../../../lib/security';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
const MAX_FILE=10*1024*1024; const ALLOWED=new Set(['image/jpeg','image/png','image/webp','image/avif']);
export async function POST(request:Request){
 if(!isAdminSession(request)) return NextResponse.json({error:'Требуется вход администратора'},{status:401});
 const limit=rateLimit(request,'admin-upload',20,60*1000); if(!limit.ok)return NextResponse.json({error:'Слишком много загрузок'},{status:429,headers:{'Retry-After':String(limit.retryAfter)}});
 try{const cloud=process.env.CLOUDINARY_CLOUD_NAME,key=process.env.CLOUDINARY_API_KEY,secret=process.env.CLOUDINARY_API_SECRET;if(!cloud||!key||!secret)return NextResponse.json({error:'Cloudinary не настроен'},{status:503});
 const form=await request.formData();const file=form.get('file');if(!(file instanceof File))return NextResponse.json({error:'Файл не выбран'},{status:400});if(!ALLOWED.has(file.type)||file.size<1||file.size>MAX_FILE)return NextResponse.json({error:'Допустимы JPG, PNG, WebP, AVIF до 10 МБ'},{status:400});
 const timestamp=Math.floor(Date.now()/1000),folder='techroom/products';const signature=crypto.createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${secret}`).digest('hex');const out=new FormData();out.append('file',file);out.append('api_key',key);out.append('timestamp',String(timestamp));out.append('folder',folder);out.append('signature',signature);
 const r=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`,{method:'POST',body:out});const j:any=await r.json();if(!r.ok||!j.secure_url)return NextResponse.json({error:'Не удалось загрузить изображение'},{status:502});return NextResponse.json({url:j.secure_url,publicId:j.public_id,width:j.width,height:j.height},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Ошибка загрузки изображения'},{status:500});}}

