import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, money, type Intent, type PaymentGateway } from '../src/domain.ts';
import { Store } from '../src/store.ts';
import { Engine } from '../src/engine.ts';
import { RulesPlanner } from '../src/planner.ts';
import { AgentEscalationError, AgentUserDecisionRequired } from '../src/agent-escalation.ts';

class Gateway implements PaymentGateway {
  mode = 'simulation' as const; calls = 0; timeout = false; settle = false;
  async snapshot() { return { ...fixture().snapshot, balance: money(this.settle ? '12' : '16'), observedAt: new Date().toISOString() }; }
  async estimate() { return money('0.01'); }
  async submit(_intent: Intent) { this.calls++; if (this.timeout) throw new Error('transport timeout'); return { providerId: 'simulation:1' }; }
  async reconcile(_intent: Intent) { return { status: this.settle ? 'simulated' as const : 'pending' as const }; }
}
test('T06 concurrent runs reserve one obligation and submit only once', async () => {
  const store = new Store(':memory:', fixture()); const gateway = new Gateway();
  const engine = new Engine(store, gateway, new RulesPlanner());
  await Promise.all([engine.run(), engine.run()]);
  assert.equal(gateway.calls, 1); assert.equal(store.read().intents.length, 1);
  assert.equal(store.read().intents[0].obligationId, 'A');
  assert.equal(store.read().intents[0].status, 'PROVIDER_ACCEPTED'); store.close();
});
test('T07 timeout survives restart and reconciles without a second submission', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'tameion-')), 'state.db');
  const gateway = new Gateway(); gateway.timeout = true;
  let store = new Store(path, fixture());
  await new Engine(store, gateway, new RulesPlanner()).run();
  assert.equal(store.read().intents[0]?.status, 'EXECUTION_UNKNOWN'); store.close();
  store = new Store(path, fixture()); const engine = new Engine(store, gateway, new RulesPlanner());
  await engine.run(); assert.equal(gateway.calls, 1);
  gateway.settle = true; await engine.reconcile();
  assert.equal(store.read().intents[0].status, 'SIMULATED');
  assert.equal(store.read().obligations[0].paid, true); assert.equal(gateway.calls, 1); store.close();
});
test('T10 fabricated candidates and addresses cannot cause submission', async () => {
  const store = new Store(':memory:', fixture()); const gateway = new Gateway();
  await new Engine(store, gateway, { name: 'bad-model', async plan() { return [{ obligationId: 'fake', action: 'PAY_NOW', reason: 'send', evidenceIds: [] }]; } }).run();
  assert.equal(gateway.calls, 0); assert.equal(store.read().runs[0]?.status, 'ERROR'); store.close();
});
test('T12 pause during fee estimation stops submission', async () => {
  const store = new Store(':memory:', fixture()); const gateway = new Gateway();
  gateway.estimate = async () => { store.change(s => { s.paused = true; }); return money('0.01'); };
  await new Engine(store, gateway, new RulesPlanner()).run();
  assert.equal(gateway.calls, 0); assert.equal(store.read().intents.length, 1); assert.equal(store.read().intents[0].status, 'CANCELLED'); store.close();
});
test('separate SQLite connections cannot reserve the same wallet concurrently', async () => {
  const path=join(mkdtempSync(join(tmpdir(),'tameion-')), 'state.db');
  const first=new Store(path,fixture()); const second=new Store(path,fixture()); const gateway=new Gateway();
  await Promise.all([new Engine(first,gateway,new RulesPlanner()).run(),new Engine(second,gateway,new RulesPlanner()).run()]);
  assert.equal(gateway.calls,1); assert.equal(second.read().intents.length,1); first.close(); second.close();
});
test('T11 a debited chain snapshot cannot make an unresolved reservation spendable', async () => {
  const store=new Store(':memory:',fixture()); const gateway=new Gateway(); const engine=new Engine(store,gateway,new RulesPlanner());
  await engine.run(); gateway.snapshot=async()=>({...fixture().snapshot,balance:money('12')});
  await engine.run(); assert.equal(gateway.calls,1);
  assert.equal(store.read().intents[0].status,'PROVIDER_ACCEPTED');
  const state=store.read();
  assert.equal(state.runs.at(-1)!.decisions.find(d=>d.obligationId==='B')!.action,'PAY_NOW');
  assert.ok(state.events.some(event=>event.type==='POLICY_HOLD'&&event.detail==='B: RECONCILE_REQUIRED')); store.close();
});
test('fee exceeding the configured allowance cancels before provider submission', async () => {
  const store=new Store(':memory:',fixture()); const gateway=new Gateway(); gateway.estimate=async()=>money('2');
  await new Engine(store,gateway,new RulesPlanner()).run();
  assert.equal(gateway.calls,0); assert.ok(store.read().intents.length>0); assert.ok(store.read().intents.every(i=>i.status==='CANCELLED')); store.close();
});
test('disabled execution remains proposal-only and does not create stuck intents', async () => {
  const store=new Store(':memory:',fixture()); const gateway=new Gateway();
  await new Engine(store,gateway,new RulesPlanner(),false).run();
  assert.equal(gateway.calls,0); assert.equal(store.read().intents.length,0);
  const state=store.read(); const decision=state.runs[0].decisions.find(d=>d.obligationId==='A')!;
  assert.equal(decision.action,'PAY_NOW'); assert.match(decision.reason,/Accepted/);
  assert.ok(state.events.some(event=>event.type==='POLICY_HOLD'&&event.detail==='A: EXECUTION_DISABLED')); store.close();
});
test('an unresolved policy rejection creates one durable user notification and no intent', async () => {
  const store=new Store(':memory:',fixture()); const gateway=new Gateway();
  const planner={name:'AI · test',async plan(){throw new AgentEscalationError([{obligationId:'A',reason:'INSUFFICIENT_FUNDS'}]);}};
  const runId=await new Engine(store,gateway,planner).run(); const state=store.read();
  assert.equal(state.intents.length,0); assert.equal(state.runs.find(run=>run.id===runId)?.status,'ERROR');
  assert.deepEqual(state.agentNotifications.map(notification=>({runId:notification.runId,type:notification.type,status:notification.status,issues:notification.issues})),[
    {runId,type:'POLICY_ESCALATION',status:'OPEN',issues:[{obligationId:'A',reason:'INSUFFICIENT_FUNDS'}]},
  ]);
  assert.ok(state.events.some(event=>event.type==='AGENT_USER_ACTION_REQUIRED'&&event.detail===runId)); store.close();
});
test('an explicit agent request pauses the run for an authoritative owner decision', async () => {
  const store=new Store(':memory:',fixture()); const gateway=new Gateway();
  const planner={name:'AI · test',async plan(state:ReturnType<typeof fixture>){throw new AgentUserDecisionRequired({obligationId:'A',policyReason:'NEEDS_APPROVAL',question:'Approve once?',obligationVersion:state.obligations[0].version,policyVersion:state.policy.version,stateVersion:state.financialVersion});}};
  const runId=await new Engine(store,gateway,planner).run(); const state=store.read(); const notification=state.agentNotifications[0];
  assert.equal(state.intents.length,0); assert.equal(state.runs.find(run=>run.id===runId)?.status,'AWAITING_USER');
  assert.equal(notification.type,'USER_DECISION_REQUIRED'); assert.equal(notification.question,'Approve once?');
  assert.equal(notification.policyVersion,state.policy.version); assert.equal(notification.stateVersion,state.financialVersion); store.close();
});

test('REQUEST_EVIDENCE creates one durable, version-bound Agent action across repeated runs', async () => {
  const state = fixture(); state.obligations = [state.obligations[2]]; state.evidence = [state.evidence[1]];
  const store = new Store(':memory:', state); const gateway = new Gateway();
  const engine = new Engine(store, gateway, new RulesPlanner(), false);
  await engine.run(); await engine.run();
  const requests = store.read().evidenceRequests;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].obligationId, 'C');
  assert.equal(requests[0].obligationVersion, 1);
  assert.equal(requests[0].status, 'OPEN');
  assert.equal(requests[0].requestedFrom, 'PROJECT_OWNER');
  assert.match(requests[0].question, /accepted/i);
  assert.ok(Date.parse(requests[0].expiresAt) > Date.parse(requests[0].createdAt));
  store.close();
});

test('a planning run persists adaptive decisions without creating a payment intent', async () => {
  const state = fixture(); state.snapshot.balance = money('1');
  const store = new Store(':memory:', state); const gateway = new Gateway();
  gateway.snapshot = async () => ({ ...fixture().snapshot, balance: money('1'), observedAt: new Date().toISOString() });
  const planner = { name: 'adaptive-test', async plan(s: ReturnType<typeof fixture>) { return s.obligations.filter(o => !o.paid).map(o => ({ obligationId: o.id, action: o.id === 'B' ? 'PAY_NOW' as const : 'HOLD' as const, reason: `Decision for ${o.id}`, evidenceIds: s.evidence.filter(e => e.obligationId === o.id).map(e => e.id) })); } };
  const engine = new Engine(store, gateway, planner);
  const runId = await engine.plan(); const run = store.read().runs.find(r => r.id === runId)!;
  assert.equal(run.status, 'DONE'); assert.equal(run.executionStatus, 'PLANNED');
  assert.equal(run.decisions.find(d => d.obligationId === 'B')!.action, 'PAY_NOW');
  assert.equal(store.read().intents.length, 0); assert.equal(gateway.calls, 0); store.close();
});

test('a persisted plan cannot execute after its financial state changes', async () => {
  const store = new Store(':memory:', fixture()); const gateway = new Gateway(); const engine = new Engine(store, gateway, new RulesPlanner());
  const runId = await engine.plan();
  store.change(s => { s.snapshot.balance = money('99'); s.snapshot.block = 'simulation:changed'; });
  await assert.rejects(engine.executePlanned(runId), /FUNDING_PLAN_STALE/);
  assert.equal(store.read().intents.length, 0); assert.equal(store.read().runs.find(r => r.id === runId)!.executionStatus, 'INVALIDATED');
  store.close();
});
