import { randomUUID } from 'node:crypto';
import type { State } from './domain.ts';
import { enqueue } from './scheduler-core.ts';

export function allocateReceipt(s:State,transferId:string,key:string,expectedAmount?:string) {
  const a=s.autonomy!,transfer=a.transfers.find(t=>t.id===transferId&&t.status==='VERIFIED'&&['UNMATCHED','CUSTOMER'].includes(t.classification));
  const record=a.records.find(r=>`${r.sourceId}:${r.externalId}`===key&&r.kind==='RECEIVABLE'&&r.active&&r.authoritative);
  if(!transfer||!record||!a.parties.some(p=>p.id===record.partyId&&p.address.toLowerCase()===transfer.sender.toLowerCase()))throw new Error('RECEIPT_MATCH_INVALID');
  const used=a.allocations.filter(x=>x.transferId===transferId).reduce((n,x)=>n+BigInt(x.amount),0n);
  const received=a.allocations.filter(x=>x.sourceRecordKey===key).reduce((n,x)=>n+BigInt(x.amount),0n);
  const remainder=BigInt(transfer.amount)-used,owed=BigInt(record.amount)-received;
  const amount=remainder<owed?remainder:owed;if(amount<=0n)throw new Error('RECEIPT_ALREADY_ALLOCATED');
  if(expectedAmount!==undefined&&amount.toString()!==expectedAmount)throw new Error('RECEIPT_MATCH_STALE');
  a.allocations.push({transferId,sourceRecordKey:key,amount:amount.toString()});transfer.classification='CUSTOMER';
  s.revenues.push({id:randomUUID(),hash:transfer.hash,source:transfer.sender,amount:amount.toString(),invoice:record.title,createdAt:new Date().toISOString(),simulated:false,sourceChain:transfer.chain,bridged:transfer.chain==='ARC-TESTNET'});
  enqueue(s,'RECEIPT_MATCH_CHANGED',`match:${transfer.id}:${key}:${received+amount}`);
}
export function matchReceipts(s:State) {
  const a=s.autonomy!;let matched=0;
  for(const transfer of a.transfers.filter(t=>t.status==='VERIFIED'&&(t.classification==='UNMATCHED'||t.classification==='CUSTOMER'))) {
    const allocated=a.allocations.filter(x=>x.transferId===transfer.id).reduce((n,x)=>n+BigInt(x.amount),0n);
    const remaining=BigInt(transfer.amount)-allocated;if(remaining<=0n)continue;
    const candidates=a.records.filter(r=>r.kind==='RECEIVABLE'&&r.active&&r.authoritative&&
      a.parties.some(p=>p.id===r.partyId&&p.address.toLowerCase()===transfer.sender.toLowerCase())&&
      a.allocations.filter(x=>x.sourceRecordKey===`${r.sourceId}:${r.externalId}`).reduce((n,x)=>n+BigInt(x.amount),0n)<BigInt(r.amount));
    // Sender association alone cannot select between two open invoices.
    if(candidates.length!==1)continue;
    const record=candidates[0],key=`${record.sourceId}:${record.externalId}`;
    allocateReceipt(s,transfer.id,key);matched++;
  }
  return matched;
}
