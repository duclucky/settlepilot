import {createHash} from 'node:crypto';
import type {ModelProvider,ModelRequestRecord} from './model-requests.ts';

export interface InputPrefix {settingsHash:string;prefixHash:string;items:number}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// New items must be plaintext. Opaque reasoning can only occur inside an exact
// prefix measured in this run and emitted by the same provider response.
function plaintext(item:any):boolean {
 if(!item||typeof item!=='object'||Array.isArray(item))return false;
 const fields:Record<string,string[]>={message:['type','role','content','id','status'],function_call:['type','name','call_id','arguments','id','status'],function_call_output:['type','call_id','output','id','status'],reasoning:['type','summary','id','status']};
 const type=item.type??(item.role?'message':'');
 if(!Object.hasOwn(fields,type)||Object.keys(item).some(key=>!fields[type].includes(key)))return false;
 if(type==='message')return ['user','assistant','system','developer'].includes(item.role)&&typeof item.content==='string';
 if(type==='function_call')return typeof item.name==='string'&&typeof item.call_id==='string'&&typeof item.arguments==='string';
 if(type==='function_call_output')return typeof item.call_id==='string'&&typeof item.output==='string';
 return Array.isArray(item.summary)&&item.summary.every((s:any)=>s?.type==='summary_text'&&typeof s.text==='string'&&Object.keys(s).every(k=>['type','text'].includes(k)));
}

function manualRequest(provider:ModelProvider,model:string,url:string,parsed:any) {
 return provider==='planner'&&/^gpt-5\.4(?:-mini|-nano)?(?:-\d{4}-\d{2}-\d{2})?$/.test(model)&&url==='https://api.openai.com/v1/responses'&&parsed.model===model&&parsed.store===false&&!parsed.previous_response_id&&!parsed.conversation&&Array.isArray(parsed.input)&&parsed.input.length>0;
}

/** Hash only: no reasoning, tool arguments or encrypted state enter the ledger. */
export function measuredReplayPrefix(provider:ModelProvider,model:string,url:string,body:string,response:any,inputPrefix?:InputPrefix):InputPrefix|undefined {
 const parsed=JSON.parse(body),{input,...settings}=parsed;
 if(!inputPrefix||!manualRequest(provider,model,url,parsed)||response?.status!=='completed'||!Array.isArray(response.output)||!response.output.length)return;
 // Other modalities and server-side references have no supported local bound.
 if(!response.output.every((item:any)=>item&&typeof item==='object'&&!Array.isArray(item)&&(item.type==='function_call'&&plaintext(item)||item.type==='reasoning'&&Array.isArray(item.summary))))return;
 const replay=[...input,...response.output];
 return {settingsHash:hash(settings),prefixHash:hash(replay),items:replay.length};
}

export function reserveInput(provider:ModelProvider,model:string,url:string,body:string,records:ModelRequestRecord[],runId:string,now:number) {
 const fallback=Buffer.byteLength(body,'utf8')+1024;
 const parsed=JSON.parse(body),{input,...settings}=parsed;
 if(!manualRequest(provider,model,url,parsed))return {inputTokens:fallback,method:'BYTE_BOUND' as const};
 const prefix:InputPrefix={settingsHash:hash(settings),prefixHash:hash(input),items:input.length};
 let observed:{record:ModelRequestRecord;prefix:InputPrefix}|undefined;
 for(let index=records.length-1;index>=0&&!observed;index--){
  const r=records[index];
  if(r.provider!==provider||r.model!==model||r.runId!==runId||r.status!=='COMPLETE'||!r.usage||r.at>now||now-r.at>300000)continue;
  for(const p of [r.replayPrefix,r.inputPrefix]){
   if(p&&p.settingsHash===prefix.settingsHash&&p.items<=input.length&&p.prefixHash===hash(input.slice(0,p.items))&&input.slice(p.items).every(plaintext)){observed={record:r,prefix:p};break;}
  }
 }
 if(!observed)return {inputTokens:fallback,method:'BYTE_BOUND' as const,...(input.every(plaintext)?{prefix}:{})};
 const anchor=observed.record,tail=input.slice(observed.prefix.items);
 // No bytes/token division: reuse observed prefix usage, reserve every new
 // UTF-8 byte, prior output/reasoning and margin for hidden framing changes.
 const measured=anchor.usage!.inputTokens+anchor.usage!.outputTokens;
 const estimate=measured+Math.ceil(measured*0.2)+Buffer.byteLength(JSON.stringify(tail),'utf8')+tail.length*64+1024;
 if(estimate>=fallback)return {inputTokens:fallback,method:'BYTE_BOUND' as const,prefix};
 return {inputTokens:estimate,method:'OBSERVED_PREFIX' as const,prefix,anchorId:anchor.id};
}
