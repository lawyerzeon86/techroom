import { NextResponse } from 'next/server';
import { isAdminSession, readJsonBody } from '../../../../../lib/security';
import { getWarehouseSettings, saveWarehouseSettings } from '../../../../../lib/marketplace-settings';

export const runtime='nodejs';
export const dynamic='force-dynamic';

async function wbWarehouses(){
  const token=(process.env.WB_API_TOKEN||'').trim();
  if(!token) throw new Error('WB_API_TOKEN_NOT_CONFIGURED');
  const res=await fetch('https://marketplace-api.wildberries.ru/api/v3/warehouses',{headers:{Authorization:token},cache:'no-store'});
  const data=await res.json().catch(()=>null);
  if(!res.ok) throw new Error(String(data?.message||data?.error||`WB_HTTP_${res.status}`));
  return (Array.isArray(data)?data:[]).map((w:any)=>({id:String(w.id),name:String(w.name||`Склад ${w.id}`),officeId:w.officeId??null,deliveryType:w.deliveryType??null,cargoType:w.cargoType??null}));
}

async function ozonWarehouses(){
  const clientId=(process.env.OZON_CLIENT_ID||'').trim();
  const apiKey=(process.env.OZON_API_KEY||'').trim();
  if(!clientId||!apiKey) throw new Error('OZON_NOT_CONFIGURED');
  const res=await fetch('https://api-seller.ozon.ru/v1/warehouse/list',{method:'POST',headers:{'Client-Id':clientId,'Api-Key':apiKey,'Content-Type':'application/json'},body:'{}',cache:'no-store'});
  const data=await res.json().catch(()=>null);
  if(!res.ok) throw new Error(String(data?.message||data?.error||`OZON_HTTP_${res.status}`));
  const rows=Array.isArray(data?.result)?data.result:[];
  return rows.map((w:any)=>({id:String(w.warehouse_id),name:String(w.name||`Склад ${w.warehouse_id}`),status:w.status??null,isRfbs:Boolean(w.is_rfbs)}));
}

export async function GET(request:Request){
  if(!isAdminSession(request)) return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  const settings=await getWarehouseSettings();
  const result:any={settings,warehouses:{wildberries:[],ozon:[]},errors:{}};
  try{result.warehouses.wildberries=await wbWarehouses()}catch(e:any){result.errors.wildberries=String(e?.message||e)}
  try{result.warehouses.ozon=await ozonWarehouses()}catch(e:any){result.errors.ozon=String(e?.message||e)}
  return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:Request){
  if(!isAdminSession(request)) return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  try{
    const body=await readJsonBody(request,8*1024);
    const settings=await saveWarehouseSettings({
      wbWarehouseId:body?.wbWarehouseId==null?undefined:String(body.wbWarehouseId),
      ozonWarehouseId:body?.ozonWarehouseId==null?undefined:String(body.ozonWarehouseId)
    });
    return NextResponse.json({ok:true,settings},{headers:{'Cache-Control':'no-store'}});
  }catch(error:any){
    return NextResponse.json({error:String(error?.message||'Не удалось сохранить склады')},{status:400});
  }
}
