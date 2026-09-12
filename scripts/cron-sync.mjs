const url=(process.env.SYNC_URL||'https://techroom-main.onrender.com/api/internal/marketplace-sync').trim();
const secret=(process.env.CRON_SYNC_SECRET||'').trim();
if(!secret){console.error('CRON_SYNC_SECRET is not configured');process.exit(1)}
const res=await fetch(url,{method:'POST',headers:{'x-cron-secret':secret,'Content-Type':'application/json'}});
const text=await res.text();
console.log(text);
if(!res.ok) process.exit(1);
