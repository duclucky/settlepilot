import {appendFileSync,statSync,existsSync} from 'node:fs';
const secretKey=/authorization|api.?key|private.?key|entity.?secret|recovery|mnemonic|bot.?token/i;
export function sanitize(value:unknown,depth=0):unknown {
  if(depth>10)return '[DEPTH_LIMIT]';
  if(typeof value==='string')return value.slice(0,4000)
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g,'[REDACTED]')
    .replace(/\bBearer\s+\S+/gi,'Bearer [REDACTED]')
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g,'[REDACTED]')
    .replace(/https?:\/\/[^\s"<>]+/gi,url=>{try{const u=new URL(url);return `${u.origin}/[URL_REDACTED]`;}catch{return '[URL_REDACTED]';}})
    .replace(/\b0x[a-fA-F0-9]{64}\b/g,'[HASH_OR_SECRET_REDACTED]');
  if(Array.isArray(value))return value.slice(0,500).map(x=>sanitize(x,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,secretKey.test(k)?'[REDACTED]':sanitize(v,depth+1)]));
  return value;
}
export function journal(path:string,suiteId:string,scenarioId:string,type:string,data:unknown){
  if(existsSync(path)&&statSync(path).size>10*1024*1024)throw new Error('AUDIT_LOG_SIZE_LIMIT');
  appendFileSync(path,JSON.stringify({schemaVersion:1,suiteId,scenarioId,at:new Date().toISOString(),type,data:sanitize(data)})+'\n','utf8');
}
