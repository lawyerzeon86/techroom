import { NextResponse } from 'next/server';
import { isAdminSession } from '../../../../../lib/security';
import { ensureProductHubSchema } from '../../../../../lib/product-hub';
import { getPool } from '../../../../../lib/db';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function classify(text:string){
  const s=text.toLowerCase();
  const rules:[RegExp,string,number][]=[
    [/(audi|bmw|mercedes|porsche|авто|порог|датчик|кожух|запчаст)/,'Автотовары / Запчасти',0.92],
    [/(кабель|заряд|адаптер|usb|электрон|науш|гаджет)/,'Электроника / Аксессуары',0.88],
    [/(3d|печать|printed|asa|abs|petg|pla|нейлон)/,'3D-печать / Изделия',0.86],
    [/(чехол|держател|креплен|аксессуар)/,'Аксессуары',0.78]
  ];
  for(const [re,category,confidence] of rules) if(re.test(s)) return {category,confidence};
  return {category:'Прочее',confidence:0.55};
}

export async function POST(request:Request){
  if(!isAdminSession(request)) return NextResponse.json({error:'Требуется вход администратора'},{status:401});
  try{
    await ensureProductHubSchema();
    const pool=getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_product_mappings (id BIGSERIAL PRIMARY KEY,hub_id BIGINT NOT NULL REFERENCES marketplace_product_hub(id) ON DELETE CASCADE,target_marketplace TEXT NOT NULL,normalized_category TEXT,mapped_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,confidence NUMERIC(5,4) NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'pending',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(hub_id,target_marketplace))`);
    const {rows}=await pool.query(`SELECT DISTINCT ON (j.hub_id,j.target_marketplace) j.hub_id,j.target_marketplace,h.title,h.description,h.dimensions,h.attributes FROM marketplace_product_jobs j JOIN marketplace_product_hub h ON h.id=j.hub_id WHERE j.status='needs_mapping' ORDER BY j.hub_id,j.target_marketplace,j.id DESC LIMIT 200`);
    let autoMapped=0,manualReview=0;
    for(const r of rows){
      const c=classify(`${r.title||''} ${r.description||''} ${JSON.stringify(r.attributes||{})}`);
      const status=c.confidence>=0.86?'auto_mapped':'manual_review';
      const attrs={...(r.attributes||{}),dimensions:r.dimensions||{}};
      await pool.query(`INSERT INTO marketplace_product_mappings(hub_id,target_marketplace,normalized_category,mapped_attributes,confidence,status,updated_at) VALUES($1,$2,$3,$4::jsonb,$5,$6,NOW()) ON CONFLICT(hub_id,target_marketplace) DO UPDATE SET normalized_category=EXCLUDED.normalized_category,mapped_attributes=EXCLUDED.mapped_attributes,confidence=EXCLUDED.confidence,status=EXCLUDED.status,updated_at=NOW()`,[r.hub_id,r.target_marketplace,c.category,JSON.stringify(attrs),c.confidence,status]);
      await pool.query(`UPDATE marketplace_product_links SET last_status=$3,last_error=NULL WHERE hub_id=$1 AND marketplace=$2`,[r.hub_id,r.target_marketplace,status]);
      await pool.query(`UPDATE marketplace_product_jobs SET status=$3,message=$4,updated_at=NOW() WHERE hub_id=$1 AND target_marketplace=$2 AND status='needs_mapping'`,[r.hub_id,r.target_marketplace,status,`Категория: ${c.category}; confidence: ${c.confidence.toFixed(2)}`]);
      if(status==='auto_mapped') autoMapped++; else manualReview++;
    }
    return NextResponse.json({ok:true,processed:rows.length,autoMapped,manualReview});
  }catch(e:any){return NextResponse.json({error:String(e?.message||'Ошибка автосопоставления')},{status:502})}
}
