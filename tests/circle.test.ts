import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CircleGateway, type CirclePort } from '../src/adapters/circle.ts';
import { ArcReader } from '../src/adapters/arc.ts';
import { fixture, CHAIN_ID, USDC, type Intent } from '../src/domain.ts';

test('Circle adapter binds durable idempotency, exact amount and capped fee; COMPLETE still needs chain proof', async () => {
  const s=fixture(); let submitted: unknown; let verified=0;
  const intent:Intent={id:randomUUID(),runId:randomUUID(),obligationId:'A',amount:'4000000',recipient:s.obligations[0].recipient,sender:s.policy.sender,chainId:CHAIN_ID,policyVersion:1,obligationVersion:1,idempotencyKey:randomUUID(),status:'SUBMITTING',createdAt:new Date().toISOString()};
  const port = {
    getWallet: async()=>({data:{wallet:{blockchain:'ARC-TESTNET',accountType:'EOA',address:intent.sender}}}),
    estimateTransferFee:async(input:unknown)=>{assert.equal((input as {amount:string[]}).amount[0],'4.000000');return {data:{medium:{gasLimit:'21000',maxFee:'20',priorityFee:'1'}}};},
    createTransaction:async(input:unknown)=>{submitted=input;return {data:{id:'provider-id'}};},
    getTransaction:async()=>({data:{transaction:{id:'provider-id',state:'COMPLETE',blockchain:'ARC-TESTNET',walletId:'wallet-id',refId:intent.id,txHash:`0x${'a'.repeat(64)}`}}}),
    listTransactions:async()=>({data:{transactions:[]}}),
  } as unknown as CirclePort;
  const arc = { network:async()=>{}, verify:async()=>{verified++;}, snapshot:async()=>s.snapshot } as unknown as ArcReader;
  const config={apiKey:'TEST_API_KEY:fake',entitySecret:'fake',walletId:'wallet-id',sender:intent.sender,sendEnabled:true,authorize:()=>true};
  const gateway=new CircleGateway(config,arc,port);
  assert.equal(await gateway.estimate(intent),'420'); await gateway.submit(intent);
  assert.deepEqual(submitted,{walletId:'wallet-id',tokenAddress:USDC,amount:['4.000000'],destinationAddress:intent.recipient,idempotencyKey:intent.idempotencyKey,refId:intent.id,fee:{type:'absolute',config:{gasLimit:'21000',maxFee:'20',priorityFee:'1'}}});
  assert.equal((await gateway.reconcile({...intent,providerId:'provider-id'})).status,'confirmed'); assert.equal(verified,1);
  arc.verify=async()=>{throw new Error('wrong recipient');};
  await assert.rejects(gateway.reconcile({...intent,providerId:'provider-id'}));
  const disabled=new CircleGateway({...config,sendEnabled:false},arc,port); await assert.rejects(disabled.submit(intent));
  const revoked=new CircleGateway({...config,authorize:()=>false},arc,port); await revoked.estimate(intent); await assert.rejects(revoked.submit(intent));
});
