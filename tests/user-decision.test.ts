import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, money } from '../src/domain.ts';
import { evaluate } from '../src/policy.ts';
import { Store } from '../src/store.ts';
import { resolveAgentUserDecision } from '../src/user-decision.ts';

function decisionState() {
  const state=fixture(); state.snapshot.balance=money('16'); state.policy.perObligation=money('3');
  state.agentNotifications.push({id:randomUUID(),runId:randomUUID(),type:'USER_DECISION_REQUIRED',status:'OPEN',title:'Agent is asking for your decision',message:'Policy conflict.',question:'Approve once?',issues:[{obligationId:'A',reason:'NEEDS_APPROVAL'}],obligationVersion:1,policyVersion:1,stateVersion:state.financialVersion,createdAt:new Date().toISOString()});
  return state;
}

test('owner approval outranks the exact operating-policy conflict and remains state-bound', () => {
  const store=new Store(':memory:',decisionState()); const notification=store.read().agentNotifications[0];
  resolveAgentUserDecision(store,notification.id,'APPROVE_ONCE','Approve this exact obligation once.');
  const state=store.read();
  assert.equal(state.agentNotifications[0].resolution,'APPROVE_ONCE');
  assert.equal(state.approvals[0].reason,'NEEDS_APPROVAL');
  assert.equal(evaluate(state,state.obligations[0]),'ALLOW');
  state.financialVersion++;
  assert.equal(evaluate(state,state.obligations[0]),'NEEDS_APPROVAL'); store.close();
});

test('keeping policy records the answer without creating an override', () => {
  const store=new Store(':memory:',decisionState()); const notification=store.read().agentNotifications[0];
  resolveAgentUserDecision(store,notification.id,'KEEP_POLICY','Do not exceed the configured limit.');
  const state=store.read(); assert.equal(state.approvals.length,0); assert.equal(state.agentNotifications[0].status,'RESOLVED');
  assert.equal(evaluate(state,state.obligations[0]),'NEEDS_APPROVAL');
  assert.throws(()=>resolveAgentUserDecision(store,notification.id,'APPROVE_ONCE','Replay.'),/NOT_OPEN/); store.close();
});
