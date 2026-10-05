export function marketplacePlainText(value:string){
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'')
    .replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/<\/?(?:p|div|li|ul|ol|h[1-6])\b[^>]*>/gi,'\n')
    .replace(/<[^>]+>/g,'')
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi,entity=>({ '&nbsp;':' ','&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>' }[entity.toLowerCase()]||entity))
    .replace(/&#(x[0-9a-f]+|\d+);/gi,(entity,code)=>{const n=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code);return n>0&&n<=0x10ffff?String.fromCodePoint(n):entity})
    .replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
