import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, type Intent } from '../src/domain.ts';
import { localSummary, paymentOutcome } from '../src/web/local-summary.ts';

test('overview requires exact verified payment evidence, rather than a paid flag or provider acceptance', () => {
  const s = fixture(); s.mode = 'testnet'; const o = s.obligations[0]; o.paid = true;
  const i: Intent = {id:'i',runId:'r',obligationId:o.id,amount:o.amount,recipient:o.recipient,sender:s.policy.sender,chainId:5042002,policyVersion:1,obligationVersion:o.version,idempotencyKey:'k',status:'PROVIDER_ACCEPTED',createdAt:o.due,hash:`0x${'a'.repeat(64)}`};
  s.intents.push(i);
  assert.equal(paymentOutcome(s,o),undefined);
  i.status='SETTLED'; assert.equal(paymentOutcome(s,o),'verified');
  for(const mismatch of [{obligationVersion:2},{amount:'1'},{chainId:1},{sender:o.recipient},{recipient:s.policy.sender},{hash:undefined}]) {
    s.intents=[{...i,...mismatch}]; assert.equal(paymentOutcome(s,o),undefined);
  }
});
test('overview uses integer amounts, counts each obligation and receipt once and separates simulation', () => {
  const s=fixture(); const o=s.obligations[0];
  s.intents=[{id:'i',runId:'r',obligationId:o.id,amount:o.amount,recipient:o.recipient,sender:s.policy.sender,chainId:5042002,policyVersion:1,obligationVersion:o.version,idempotencyKey:'k',status:'SIMULATED',createdAt:o.due}];
  s.intents.push({...s.intents[0],id:'duplicate'});
  s.revenues=[{id:'receipt',amount:'9007199254740993',invoice:'Work',source:'Sample',createdAt:o.due,simulated:true}];
  assert.equal(localSummary(s).settled,'4000000'); assert.equal(localSummary(s).received,'9007199254740993');
  s.mode='testnet'; assert.equal(localSummary(s).settled,'0'); assert.equal(localSummary(s).received,'0');
  const receipt={...s.revenues[0],simulated:false,hash:`0x${'b'.repeat(64)}`};s.revenues=[receipt,{...receipt,id:'duplicate'}];
  assert.equal(localSummary(s).received,receipt.amount);
});
