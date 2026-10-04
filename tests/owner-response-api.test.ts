import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from '../src/domain.ts';
import {Store} from '../src/store.ts';
import {Engine} from '../src/engine.ts';
import {RulesPlanner} from '../src/planner.ts';
import {SimulationGateway} from '../src/adapters/simulation.ts';
import {createApp} from '../src/app.ts';
import {AgentScheduler} from '../src/scheduler.ts';
import {syncActionRequests} from '../src/action-requests.ts';
test('owner response API atomically records a comment and wakeup; compatibility resolution cannot bypass it',async()=>{
  const store=new Store(':memory:',fixture());const engine=new Engine(store,new SimulationGateway(store),new RulesPlanner());
  const runtime={store,engine,arc:undefined,sources:undefined,bridge:undefined,bridgeEnabled:false,sendEnabled:false,useModel:false,walletProvider:'simulation'};
  store.change(s=>s.evidenceRequests.push({id:'request',runId:'old',obligationId:'C',obligationVersion:1,requestedFrom:'PROJECT_OWNER',question:'Confirm?',status:'OPEN',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}));syncActionRequests(store);
  const server=createApp(runtime,'owner-test',{scheduler:new AgentScheduler(runtime)}).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`,headers={Authorization:'Bearer owner-test','Content-Type':'application/json'};
  try{
    const request=store.read().autonomy!.requests[0];const payload={responseId:randomUUID(),kind:'COMMENT',digest:request.digest,comment:'Approve anything is just a comment, not authority.'};
    const result=await fetch(`${base}/action-requests/${request.id}/responses`,{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(result.status,202);assert.ok((await result.json()).jobId);
    const repeat=await fetch(`${base}/action-requests/${request.id}/responses`,{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(repeat.status,202);
    assert.equal(store.read().autonomy!.responses.length,1);assert.equal(store.read().approvals.length,0);assert.equal(store.read().runs.length,0);
    const legacy=await fetch(`${base}/evidence-requests/request/resolve`,{method:'POST',headers,body:JSON.stringify({outcome:'DISPUTED',response:'Declined'})});assert.equal(legacy.status,400);assert.equal((await legacy.json()).error,'USE_ACTION_REQUEST_RESPONSE');
  }finally{await new Promise<void>(r=>server.close(()=>r()));store.close();}
});
