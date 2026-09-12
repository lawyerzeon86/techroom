const url=(process.env.SYNC_URL||'https://techroom-main.onrender.com/api/internal/marketplace-sync').trim();
const headers={'Content-Type':'application/json'};
if(process.env.CRON_SYNC_SECRET?.trim()) headers['x-cron-secret']=process.env.CRON_SYNC_SECRET.trim();
const res=await fetch(url,{method:'POST',headers});
const text=await res.text();
console.log(text);
if(!res.ok && res.status!==202) process.exit(1);
