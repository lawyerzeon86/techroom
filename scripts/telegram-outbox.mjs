import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
  if(process.argv[2]==='export'){
    const c=await pool.connect();
    try{
      await c.query('BEGIN');
      const messages=(await c.query(`UPDATE telegram_outbox SET status='processing',attempts=attempts+1,lease_until=NOW()+INTERVAL '10 minutes'
        WHERE id IN (SELECT id FROM telegram_outbox WHERE status='pending' OR (status='processing' AND lease_until<NOW()) ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED)
        RETURNING id,payload,attempts`)).rows;
      await c.query('COMMIT');
      process.stdout.write(JSON.stringify({token:process.env.TELEGRAM_BOT_TOKEN||'',messages}));
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }else if(process.argv[2]==='ack'){
    let input='';for await(const chunk of process.stdin)input+=chunk;
    for(const r of JSON.parse(input)){
      if(!/^\d+$/.test(String(r.id))||!Number.isInteger(r.attempts))throw new Error('INVALID_ACK');
      await pool.query(`UPDATE telegram_outbox SET status=$1,sent_at=CASE WHEN $1='sent' THEN NOW() ELSE sent_at END,lease_until=NULL WHERE id=$2 AND status='processing' AND attempts=$3`,[r.ok?'sent':r.permanent?'failed':'pending',r.id,r.attempts]);
    }
    console.log('TELEGRAM_OUTBOX_ACKNOWLEDGED');
  }else throw new Error('EXPECTED_EXPORT_OR_ACK');
}finally{await pool.end();}
