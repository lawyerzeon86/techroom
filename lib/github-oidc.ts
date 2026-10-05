import { createPublicKey, verify } from 'node:crypto';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const AUDIENCE = 'techroom-marketplace-sync';
type Claims = Record<string, unknown> & { iss?:string; aud?:string|string[]; exp?:number; nbf?:number; repository?:string; ref?:string; workflow_ref?:string };

let jwksCache: { expiresAt:number; keys:any[] } | null = null;

function decodePart(value:string){
  return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
}

async function getKeys(){
  if(jwksCache&&jwksCache.expiresAt>Date.now())return jwksCache.keys;
  const response=await fetch(JWKS_URL,{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`GITHUB_JWKS_${response.status}`);
  const data:any=await response.json();
  if(!Array.isArray(data?.keys))throw new Error('GITHUB_JWKS_INVALID');
  jwksCache={keys:data.keys,expiresAt:Date.now()+60*60*1000};
  return data.keys;
}

export async function verifyGitHubActionsToken(token:string){
  const parts=token.split('.');
  if(parts.length!==3)return false;
  let header:any,claims:Claims;
  try{header=decodePart(parts[0]);claims=decodePart(parts[1]);}catch{return false}
  if(header?.alg!=='RS256'||typeof header?.kid!=='string')return false;
  const key=(await getKeys()).find((candidate:any)=>candidate.kid===header.kid&&candidate.kty==='RSA');
  if(!key)return false;
  const valid=verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url'));
  if(!valid)return false;

  const now=Math.floor(Date.now()/1000);
  const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  const repository=process.env.GITHUB_SYNC_REPOSITORY?.trim()||'lawyerzeon86/techroom';
  const workflow=`${repository}/.github/workflows/marketplace-sync.yml@refs/heads/main`;
  return claims.iss===ISSUER
    &&audiences.includes(AUDIENCE)
    &&typeof claims.exp==='number'&&claims.exp>now
    &&(typeof claims.nbf!=='number'||claims.nbf<=now+30)
    &&claims.repository===repository
    &&claims.ref==='refs/heads/main'
    &&claims.workflow_ref===workflow;
}
