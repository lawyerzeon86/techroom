import fs from 'node:fs';
import pg from 'pg';

const quote=s=>'"'+s.replaceAll('"','""')+'"';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false}});
try{
  const file='/root/duisun-migration/source-snapshot.json';
  if(fs.existsSync(file)){
    const snapshot=JSON.parse(fs.readFileSync(file,'utf8'));
    for(const table of snapshot.tables){
      for(const col of table.columns){
        if(!col.default_value||col.default_value.startsWith('nextval('))continue;
        const dest=(await pool.query(`SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,[table.name,col.name])).rows[0];
        if(dest&&dest.column_default==null){
          // Only PostgreSQL scalar defaults, never arbitrary expressions/functions.
          if(!/^(now\(\)|CURRENT_TIMESTAMP|true|false|-?\d+(\.\d+)?|'(?:[^']|'')*'::[a-z0-9_ ]+)$/.test(col.default_value))throw new Error('Unsupported default: '+table.name+'.'+col.name);
          await pool.query(`ALTER TABLE public.${quote(table.name)} ALTER COLUMN ${quote(col.name)} SET DEFAULT ${col.default_value}`);
        }
      }
    }
  }
  console.log('Historical table defaults verified');
  const migrated=await pool.query(`
    UPDATE products
    SET image_url=CASE
          WHEN image_url LIKE 'https://techroom-main.onrender.com/%'
            THEN replace(image_url,'https://techroom-main.onrender.com','https://duisun.ru')
          ELSE image_url
        END,
        image_urls=(
          SELECT COALESCE(jsonb_agg(
            CASE
              WHEN value LIKE 'https://techroom-main.onrender.com/%'
                THEN to_jsonb(replace(value,'https://techroom-main.onrender.com','https://duisun.ru'))
              ELSE to_jsonb(value)
            END
          ),'[]'::jsonb)
          FROM jsonb_array_elements_text(image_urls)
        ),
        updated_at=NOW()
    WHERE image_url LIKE 'https://techroom-main.onrender.com/%'
       OR image_urls::text LIKE '%techroom-main.onrender.com%'
  `);
  console.log('Render image URLs migrated',migrated.rowCount);
}finally{await pool.end()}
