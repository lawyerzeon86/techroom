let input='';for await(const chunk of process.stdin)input+=chunk;
const {token,messages}=JSON.parse(input);
const results=[];
for(const m of messages){
  let ok=false,permanent=false;
  try{
    const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m.payload),signal:AbortSignal.timeout(20000)});
    const d=await r.json();ok=r.ok&&d.ok===true;permanent=r.status>=400&&r.status<500&&r.status!==429;
  }catch{}
  results.push({id:m.id,attempts:m.attempts,ok,permanent});
}
// Only acknowledgements go to stdout, consumed over SSH; credentials never reach logs.
process.stdout.write(JSON.stringify(results));
console.error('TELEGRAM_OUTBOX_DELIVERY',JSON.stringify({total:results.length,sent:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length}));
