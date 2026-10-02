import { NextResponse } from 'next/server';
import { processWhatsAppWebhook,verifyWhatsAppSignature } from '../../../../lib/whatsapp';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:Request){
  const url=new URL(request.url);
  const mode=url.searchParams.get('hub.mode');
  const token=url.searchParams.get('hub.verify_token');
  const challenge=url.searchParams.get('hub.challenge');
  const expected=process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if(mode==='subscribe'&&expected&&token===expected&&challenge)return new Response(challenge,{status:200,headers:{'Content-Type':'text/plain'}});
  return NextResponse.json({error:'Webhook verification failed'},{status:403});
}

export async function POST(request:Request){
  const raw=await request.text();
  if(!verifyWhatsAppSignature(raw,request.headers.get('x-hub-signature-256')))return NextResponse.json({error:'Invalid signature'},{status:401});
  let payload:any;try{payload=raw?JSON.parse(raw):{}}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
  try{await processWhatsAppWebhook(payload);return NextResponse.json({ok:true})}
  catch(error:any){console.error('WhatsApp webhook error',error);return NextResponse.json({error:'Webhook processing failed'},{status:500})}
}
