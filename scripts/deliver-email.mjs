import nodemailer from 'nodemailer';
import pg from 'pg';
const configured=Boolean(process.env.SMTP_HOST&&process.env.SMTP_USER&&(process.env.SMTP_PASSWORD||process.env.SMTP_PASS)&&(process.env.EMAIL_FROM||process.env.SMTP_FROM));
if(!configured){console.log('EMAIL_DELIVERY_BLOCKED_MISSING_SMTP');process.exit(0);}
const port=Number(process.env.SMTP_PORT||587);
const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:port===465,requireTLS:port!==465,
  auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD||process.env.SMTP_PASS},
  connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,disableFileAccess:true,disableUrlAccess:true});
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
let sent=0,failed=0;
try{
  const rows=(await pool.query("SELECT id,payload FROM email_outbox WHERE sent_at IS NULL AND attempts<10 AND (last_attempt_at IS NULL OR last_attempt_at<NOW()-INTERVAL '5 minutes') ORDER BY id LIMIT 20")).rows;
  for(const row of rows){
    await pool.query('UPDATE email_outbox SET attempts=attempts+1,last_attempt_at=NOW() WHERE id=$1',[row.id]);
    try{
      await transport.sendMail({from:process.env.EMAIL_FROM||process.env.SMTP_FROM,to:row.payload.to,subject:row.payload.subject,text:row.payload.text,messageId:`<techroom-order-${row.id}@duisun.ru>`});
      await pool.query('UPDATE email_outbox SET sent_at=NOW(),last_error=NULL WHERE id=$1',[row.id]);sent++;
    }catch(e){await pool.query('UPDATE email_outbox SET last_error=$1 WHERE id=$2',[String(e.code||'SMTP_DELIVERY_FAILED'),row.id]);failed++;}
  }
  console.log('EMAIL_DELIVERY',JSON.stringify({sent,failed}));
}finally{transport.close();await pool.end();}
