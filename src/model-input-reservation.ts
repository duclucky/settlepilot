import {createHash} from 'node:crypto';
import type {ModelProvider,ModelRequestRecord} from './model-requests.ts';

export interface InputPrefix {settingsHash:string;prefixHash:string;items:number}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Only manually replayed plaintext tool history has a locally inspectable
// prefix. Opaque reasoning, files/images and server references use the fallback.
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

export function reserveInput(provider:ModelProvider,model:string,url:string,body:string,records:ModelRequestRecord[],runId:string,now:number) {
 const fallback=Buffer.byteLength(body,'utf8')+1024;
 const parsed=JSON.parse(body),{input,...settings}=parsed;
 const eligible=provider==='planner'&&/^gpt-5\.4(?:-mini|-nano)?(?:-\d{4}-\d{2}-\d{2})?$/.test(model)&&url==='https://api.openai.com/v1/responses'&&parsed.model===model&&parsed.store===false&&!parsed.previous_response_id&&!parsed.conversation&&Array.isArray(input)&&input.length>0&&input.every(plaintext);
 if(!eligible)return {inputTokens:fallback,method:'BYTE_BOUND' as const};
 const prefix:InputPrefix={settingsHash:hash(settings),prefixHash:hash(input),items:input.length};
 const anchor=records.findLast(r=>r.provider===provider&&r.model===model&&r.runId===runId&&r.status==='COMPLETE'&&r.usage&&r.at<=now&&now-r.at<=300000&&r.inputPrefix?.settingsHash===prefix.settingsHash&&r.inputPrefix.items<=input.length&&r.inputPrefix.prefixHash===hash(input.slice(0,r.inputPrefix.items)));
 if(!anchor)return {inputTokens:fallback,method:'BYTE_BOUND' as const,prefix};
 const tail=input.slice(anchor.inputPrefix!.items);
 // No bytes/token division: reuse observed prefix usage, reserve every new
 // UTF-8 byte, prior output/reasoning and margin for hidden framing changes.
 const estimate=anchor.usage!.inputTokens+anchor.usage!.outputTokens+Math.ceil(anchor.usage!.inputTokens*0.2)+Buffer.byteLength(JSON.stringify(tail),'utf8')+tail.length*64+1024;
 if(estimate>=fallback)return {inputTokens:fallback,method:'BYTE_BOUND' as const,prefix};
 return {inputTokens:estimate,method:'OBSERVED_PREFIX' as const,prefix,anchorId:anchor.id};
}
