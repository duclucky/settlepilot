import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, money } from '../src/domain.ts';
import { Store } from '../src/store.ts';
import { TelegramNotificationDispatcher } from '../src/telegram-notifications.ts';
import { syncActionRequests } from '../src/action-requests.ts';

function transport(messages: { url: string; body: Record<string, unknown> }[]) {
  return (async (url, init) => {
    messages.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: messages.length } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

test('unknown bridge has one Telegram incident, keeps reminder timing through snapshots, stops on settlement',async()=>{
  const now=Date.parse('2026-10-03T12:00:00Z'),s=fixture(),store=new Store(':memory:',s),messages:{url:string;body:Record<string,unknown>}[]=[];
  const dispatcher=new TelegramNotificationDispatcher(store,{token:'123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',chatId:'987654',transport:transport(messages)});
  await dispatcher.tick(now);
  store.change(s=>s.bridgeIntents.push({id:'bridge',sourceChain:'BASE-SEPOLIA',destinationChain:'ARC-TESTNET',sourceWallet:s.policy.sender,recipient:s.policy.sender,amount:'45001',fee:'19135',totalBurn:'64136',policyVersion:1,idempotencyKey:randomUUID(),status:'EXECUTION_UNKNOWN',createdAt:new Date(now).toISOString()}));
  syncActionRequests(store,now);await dispatcher.tick(now+1000);assert.equal(messages.length,1);
  store.change(s=>{s.snapshot.balance='110000';});syncActionRequests(store,now+2000);await dispatcher.tick(now+2000);assert.equal(messages.length,1);
  await dispatcher.tick(now+30*60000+1000);assert.equal(messages.length,2);
  store.change(s=>{s.bridgeIntents[0].status='SETTLED';});syncActionRequests(store,now+31*60000);await dispatcher.tick(now+31*60000);
  assert.equal(messages.length,2);assert.equal(store.read().telegramDeliveries.filter(d=>d.status==='ACTIVE').length,0);store.close();
});

test('recreated proposal for the same problem shares reminders while a different obligation gets its own alert',async()=>{
  const now=Date.parse('2026-10-03T12:00:00Z'),store=new Store(':memory:',fixture()),messages:{url:string;body:Record<string,unknown>}[]=[];
  const dispatcher=new TelegramNotificationDispatcher(store,{token:'123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',chatId:'987654',transport:transport(messages)});
  const proposal=(id:string,obligationId:string)=>({id,runId:randomUUID(),type:'USER_DECISION_REQUIRED' as const,status:'OPEN' as const,title:'Review',message:'Review',issues:[{obligationId,reason:'NEEDS_APPROVAL'}],obligationVersion:1,policyVersion:1,createdAt:new Date(now).toISOString()});
  store.change(s=>s.agentNotifications.push(proposal('one','A')));await dispatcher.tick(now);assert.equal(messages.length,1);
  store.change(s=>{s.agentNotifications[0].status='RESOLVED';s.agentNotifications.push(proposal('two','A'));});await dispatcher.tick(now+10000);assert.equal(messages.length,1);
  store.change(s=>s.agentNotifications.push(proposal('other','B')));await dispatcher.tick(now+20000);assert.equal(messages.length,2);store.close();
});

test('migration reuses legacy delivery clocks and concurrent ticks cannot duplicate a send',async()=>{
  const now=Date.parse('2026-10-03T12:00:00Z'),s=fixture();
  s.bridgeIntents.push({id:'bridge',sourceChain:'BASE-SEPOLIA',destinationChain:'ARC-TESTNET',sourceWallet:s.policy.sender,recipient:s.policy.sender,amount:'45001',fee:'19135',totalBurn:'64136',policyVersion:1,idempotencyKey:randomUUID(),status:'EXECUTION_UNKNOWN',createdAt:new Date(now).toISOString()});
  s.telegramDeliveries.push({id:'legacy',fingerprint:'bridge-unknown:bridge',kind:'OPERATION_UNCERTAIN',subjectId:'bridge',severity:'HIGH',status:'ACTIVE',repeat:true,createdAt:new Date(now-60000).toISOString(),lastSentAt:new Date(now-1000).toISOString(),lastSentSeverity:'HIGH',sendCount:1,failureCount:0});
  const store=new Store(':memory:',s);syncActionRequests(store,now);let calls=0,blocking=false,release:()=>void=()=>{};
  const blocked=(async()=>{calls++;if(blocking)await new Promise<void>(r=>{release=r;});return new Response(JSON.stringify({ok:true,result:{message_id:2}}));}) as typeof fetch;
  const dispatcher=new TelegramNotificationDispatcher(store,{token:'123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',chatId:'987654',transport:blocked});
  // No new message on migration; this also finishes without waiting on blocked transport.
  await dispatcher.tick(now);assert.equal(calls,0);
  blocking=true;const first=dispatcher.tick(now+30*60000);await Promise.resolve();
  const second=dispatcher.tick(now+30*60000);release();await Promise.all([first,second]);assert.equal(calls,1);store.close();
});

test('Telegram sends content-free medium reminders, escalates near deadline, and stops after local resolution', async () => {
  const now=Date.parse('2026-09-29T00:00:00.000Z'); const state=fixture(); state.obligations[0].id='OBL-PRIVATE-77'; state.obligations[0].due=new Date(now+48*60*60_000).toISOString();
  const store=new Store(':memory:',state); const messages:{url:string;body:Record<string,unknown>}[]=[];
  const dispatcher=new TelegramNotificationDispatcher(store,{token:'123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',chatId:'987654',transport:transport(messages)});
  await dispatcher.tick(now); assert.equal(messages.length,0);
  const notificationId=randomUUID();
  store.change(s=>s.agentNotifications.push({id:notificationId,runId:randomUUID(),type:'USER_DECISION_REQUIRED',status:'OPEN',title:'private title',message:'private message',question:'Approve 4 USDC for North Studio?',issues:[{obligationId:'OBL-PRIVATE-77',reason:'NEEDS_APPROVAL'}],obligationVersion:1,policyVersion:1,stateVersion:s.financialVersion,createdAt:new Date(now+1000).toISOString()}));
  await dispatcher.tick(now+2000); assert.equal(messages.length,1);
  assert.match(String(messages[0].body.text),/MEDIUM/); assert.match(String(messages[0].body.text),/local/i);
  for (const secret of ['North Studio','4 USDC','OBL-PRIVATE-77','NEEDS_APPROVAL','private title','private message']) assert.equal(String(messages[0].body.text).includes(secret),false);
  assert.deepEqual(Object.keys(messages[0].body).sort(),['chat_id','disable_notification','protect_content','text']);
  await dispatcher.tick(now+5*60*60_000); assert.equal(messages.length,1);
  await dispatcher.tick(now+6*60*60_000+2000); assert.equal(messages.length,2);
  store.change(s=>{s.obligations[0].due=new Date(now+6*60*60_000+30*60_000).toISOString();});
  await dispatcher.tick(now+6*60*60_000+3000); assert.equal(messages.length,3); assert.match(String(messages[2].body.text),/HIGH/);
  await dispatcher.tick(now+6*60*60_000+29*60_000); assert.equal(messages.length,3);
  await dispatcher.tick(now+6*60*60_000+30*60_000+4000); assert.equal(messages.length,4);
  store.change(s=>{s.agentNotifications.find(item=>item.id===notificationId)!.status='RESOLVED';});
  await dispatcher.tick(now+7*60*60_000); assert.equal(messages.length,4); store.close();
});

test('Telegram delivery failure is isolated and retried without storing the response body', async () => {
  const now=Date.parse('2026-09-29T00:00:00.000Z'); const store=new Store(':memory:',fixture()); let calls=0;
  const flaky=(async()=>{calls++;return calls===1?new Response('provider secret detail',{status:500}):new Response(JSON.stringify({ok:true,result:{message_id:42}}),{status:200,headers:{'content-type':'application/json'}});}) as typeof fetch;
  const dispatcher=new TelegramNotificationDispatcher(store,{token:'123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',chatId:'987654',transport:flaky});
  await dispatcher.tick(now);
  store.change(s=>s.agentNotifications.push({id:randomUUID(),runId:randomUUID(),type:'POLICY_ESCALATION',status:'OPEN',title:'secret',message:'secret',issues:[{obligationId:'A',reason:'BUDGET_EXCEEDED'}],createdAt:new Date(now+1000).toISOString()}));
  await dispatcher.tick(now+2000); let delivery=store.read().telegramDeliveries[0]; assert.equal(delivery.failureCount,1); assert.equal(JSON.stringify(delivery).includes('provider secret detail'),false);
  await dispatcher.tick(now+60_000); assert.equal(calls,1);
  await dispatcher.tick(now+122_000); delivery=store.read().telegramDeliveries[0]; assert.equal(calls,2); assert.equal(delivery.sendCount,1); store.close();
});

test('normal settlement notification is sent once and contains no payment data', async () => {
  const now=Date.parse('2026-09-29T00:00:00.000Z'); const store=new Store(':memory:',fixture()); const messages:{url:string;body:Record<string,unknown>}[]=[];
  const dispatcher=new TelegramNotificationDispatcher(store,{token:'123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',chatId:'-100123456',transport:transport(messages)});
  await dispatcher.tick(now);
  store.change(s=>s.intents.push({id:randomUUID(),runId:randomUUID(),obligationId:'A',amount:money('4'),recipient:s.obligations[0].recipient,sender:s.policy.sender,chainId:s.policy.chainId,policyVersion:s.policy.version,obligationVersion:1,idempotencyKey:randomUUID(),status:'SETTLED',createdAt:new Date(now+1000).toISOString(),settledAt:new Date(now+2000).toISOString(),hash:`0x${'a'.repeat(64)}`}));
  await dispatcher.tick(now+3000); await dispatcher.tick(now+24*60*60_000);
  assert.equal(messages.length,1); assert.match(String(messages[0].body.text),/NORMAL/); assert.match(String(messages[0].body.text),/payment completed/i);
  assert.equal(String(messages[0].body.text).includes('4'),false); assert.equal(String(messages[0].body.text).includes('0x'),false);
  assert.equal(messages[0].body.disable_notification,true); assert.match(messages[0].url,/\/sendMessage$/); store.close();
});
