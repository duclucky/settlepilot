import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,type Intent} from '../src/domain.ts';
import {Store} from '../src/store.ts';
import {ArcReader} from '../src/adapters/arc.ts';
import {verifyAutonomous} from '../src/audit/verify-autonomous.ts';
test('live audit verifies an Agent SCA payout using wallet outflows rather than the relayer tx.from',async()=>{
 const root=mkdtempSync(join(tmpdir(),'tameion-proof-'));const state=fixture();state.mode='testnet';
 const started=new Date(Date.now()-10000).toISOString();
 state.autonomy={schemaVersion:1,enabled:true,sourceAuthority:true,records:[{sourceId:'audit',externalId:'delivery',revision:1,hash:'record',kind:'OBLIGATION',partyId:'contractor',title:'Accepted',amount:'50000',due:started,acceptance:'ACCEPTED',evidence:'',active:true,authoritative:true,importedAt:started}],parties:[],transfers:[],allocations:[],checkpoints:[],jobs:[],requests:[],responses:[],workers:[],fence:0,rejectionBindings:[]};
 state.intents=[{id:'payout',obligationId:'audit-delivery',status:'SETTLED',hash:`0x${'a'.repeat(64)}`,createdAt:new Date().toISOString(),sender:state.policy.sender,recipient:state.policy.allowlist[0],amount:'50000',chainId:5042002,idempotencyKey:'unique',agentDispatchAt:new Date().toISOString()} as Intent];
 const store=new Store(join(root,'case.db'),state);store.close();
 writeFileSync(join(root,'manifest.json'),JSON.stringify({suiteId:'fixture',mode:'live',startedAt:started}));writeFileSync(join(root,'summary.json'),JSON.stringify({results:[{id:'A02',database:'case.db',paymentIds:['payout']}]}));
 const oldDirect=ArcReader.prototype.verify,oldAgent=ArcReader.prototype.verifyAgentTransfer;let calls=0;
 ArcReader.prototype.verify=async()=>{throw new Error('DIRECT_EOA_PROOF_CANNOT_VERIFY_RELAYER');};
 ArcReader.prototype.verifyAgentTransfer=async(hash,expected)=>{assert.equal(expected.recipient,state.policy.allowlist[0]);assert.equal(expected.amount,'50000');calls++;return{hash,block:'2',timestamp:Date.now()};};
 try{const proof=await verifyAutonomous(root,true);assert.equal(calls,1);assert.equal(proof.reports[0].verifiedPayouts,1);assert.equal(proof.liveReceiptsVerified,false);}
 finally{ArcReader.prototype.verify=oldDirect;ArcReader.prototype.verifyAgentTransfer=oldAgent;}
});
