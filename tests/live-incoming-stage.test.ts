import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from '../src/domain.ts';
import {runLiveEvents} from '../src/audit/live-observation.ts';
test('live observer can wait for a customer deposit before publishing payable conditions',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tameion-incoming-'));const suite='11111111-1111-4111-8111-111111111111',sourceId='audit-11111111';
 const state=fixture();state.mode='testnet';state.obligations=[];state.evidence=[];state.bridgePolicy.enabled=true;state.autonomy={schemaVersion:1,enabled:true,sourceAuthority:true,sourceDirectory:dir,records:[],parties:[],transfers:[{id:'receipt',chain:'BASE-SEPOLIA',hash:`0x${'a'.repeat(64)}`,logIndex:1,sender:state.policy.allowlist[0],recipient:state.policy.sender,amount:'100000',block:'1',blockHash:'b',status:'VERIFIED',classification:'CUSTOMER'}],allocations:[{transferId:'receipt',sourceRecordKey:sourceId+':A01-invoice',amount:'100000'}],checkpoints:[],jobs:[],requests:[],responses:[],workers:[],fence:0,rejectionBindings:[],observationPaused:false};
 const panel={...state,sendEnabled:true,bridgeEnabled:true,walletProvider:'agent',planner:'AI · gpt-5.4 + Jev'};
 const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/api/session'?{token:'fixture'}:req.url==='/api/source-settings'?{sourceDirectory:dir,sourceAuthority:true}:panel));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
 const manifest=join(dir,'manifest.fixture');writeFileSync(manifest,JSON.stringify({schemaVersion:1,cases:[{scenarioId:'A01',source:{sourceId,records:[{externalId:'A01-invoice',revision:1,kind:'RECEIVABLE',partyId:'customer',title:'Customer invoice',amount:'0.1',due:new Date().toISOString()}]},expected:'INCOMING',timeoutSeconds:1800}]}));
 try{const result=await runLiveEvents(`http://127.0.0.1:${port}`,manifest,suite,new Date().toISOString(),{completedIds:[],publishedIds:[]},()=>{});assert.equal(result.results[0].status,'OBSERVED_PENDING_RPC_VERIFICATION');assert.equal(result.state.intents.length,0);assert.ok(existsSync(join(dir,`tameion-${suite}-A01.json`)));}
 finally{await new Promise<void>(r=>server.close(()=>r()));}
});
