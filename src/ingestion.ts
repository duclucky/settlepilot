import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Address, isPending, money, type State } from './domain.ts';
import { Store, event } from './store.ts';
import { enqueue } from './scheduler-core.ts';

const RecordInput=z.object({
  externalId:z.string().regex(/^[A-Za-z0-9_-]{1,48}$/),revision:z.number().int().positive(),
  kind:z.enum(['OBLIGATION','RECEIVABLE']),partyId:z.string().min(1).max(80),title:z.string().min(1).max(160),
  amount:z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/).transform(money).refine(v=>BigInt(v)>0n),
  due:z.iso.datetime(),acceptance:z.enum(['ACCEPTED','DISPUTED','UNKNOWN']).default('UNKNOWN'),
  evidence:z.string().max(4000).default(''),active:z.boolean().default(true),
}).strict();
export const SourceEnvelope=z.object({sourceId:z.string().regex(/^[A-Za-z0-9_-]{1,20}$/),
  parties:z.array(z.object({id:z.string().min(1).max(80),name:z.string().min(1).max(100),address:Address}).strict()).max(100).default([]),
  records:z.array(z.unknown()).max(200)}).strict();
export function ingestSource(store:Store, raw:unknown, authority=false) {
  return store.change(s=>ingestIntoState(s,raw,authority));
}
export function ingestIntoState(s:State,raw:unknown,authority=false){
  const envelope=SourceEnvelope.parse(raw);
  let accepted=0,rejected=0;
  {
    const a=s.autonomy!;
    for(const p of envelope.parties) {
      if(!authority && !s.policy.allowlist.includes(p.address) && p.address!==s.policy.sender) throw new Error('PARTY_ADDRESS_NOT_CONFIGURED');
      const old=a.parties.find(x=>x.id===p.id);
      if(old&&old.address!==p.address) throw new Error('PARTY_REGISTRY_CHANGE_REQUIRES_OWNER');
      if(!old)a.parties.push(p);
    }
    for(const candidate of envelope.records) {
      const parsed=RecordInput.safeParse(candidate);
      if(!parsed.success) {rejected++;continue;}
      const input=parsed.data;
      const key=`${envelope.sourceId}:${input.externalId}`;
      const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const old=a.records.find(r=>r.sourceId===envelope.sourceId&&r.externalId===input.externalId);
      if(old&&old.revision>input.revision)continue;
      if(old&&old.kind!==input.kind){rejected++;continue;}
      if(old&&old.revision===input.revision){if(old.hash!==hash){rejected++;continue;}
        const mapped=a.parties.some(p=>p.id===input.partyId);
        const materialized=s.obligations.some(o=>o.id===`${envelope.sourceId}-${input.externalId}`);
        if((input.kind!=='OBLIGATION'||materialized||!mapped)&&old.authoritative===authority)continue;
      }
      const record={...input,sourceId:envelope.sourceId,hash,authoritative:authority,importedAt:new Date().toISOString()};
      const id=`${envelope.sourceId}-${input.externalId}`;
      const obligation=s.obligations.find(o=>o.id===id);
      if(obligation?.paid || s.intents.some(i=>i.obligationId===id&&isPending(i))) {
        if(old)Object.assign(old,{...record,amendment:true});else a.records.push({...record,amendment:true});
        event(s,'SOURCE_AMENDMENT_REQUIRES_REVIEW',id);rejected++;continue;
      }
      const party=a.parties.find(p=>p.id===input.partyId);
      if(old)Object.assign(old,record);else a.records.push(record);
      if(input.kind==='OBLIGATION'&&party&&input.active) {
        if(!s.policy.allowlist.includes(party.address)) {rejected++;continue;}
        const next={id,title:input.title,contractor:party.name,recipient:party.address,amount:input.amount,due:input.due,
          accepted:authority&&input.acceptance==='ACCEPTED',disputed:authority&&input.acceptance==='DISPUTED',paid:false,version:(obligation?.version??0)+1};
        if(obligation)Object.assign(obligation,next);else s.obligations.push(next);
        if(input.evidence)s.evidence.push({id:`source:${key}:${input.revision}`,obligationId:id,text:input.evidence,author:`Source ${envelope.sourceId} (${authority?'authorized fields':'untrusted evidence'})`,createdAt:new Date().toISOString()});
      }
      if(!party || !input.active)event(s,'SOURCE_REQUIRES_OWNER_REVIEW',id);
      enqueue(s,'SOURCE_UPDATED',`source:${key}:${input.revision}`);accepted++;
    }
    if(a.records.length>200 || s.obligations.length>200 || s.evidence.length>500)throw new Error('SOURCE_STORAGE_LIMIT');
    if(accepted||rejected)event(s,'SOURCE_SYNC_COMPLETED',`${accepted} updated; ${rejected} quarantined`);
  }
  return {accepted,rejected};
}
