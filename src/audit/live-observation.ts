import {readFileSync,realpathSync,writeFileSync,renameSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {Address,money,isPending,isBridgePending,type State} from '../domain.ts';
import {SourceEnvelope} from '../ingestion.ts';

const EventManifest=z.object({schemaVersion:z.literal(1),cases:z.array(z.object({
  scenarioId:z.string().regex(/^A\d{2}$/),
  source:SourceEnvelope,
  expected:z.enum(['PAYOUT','CCTP_PAYOUT','OWNER_INPUT','HOLD','INCOMING_PAYOUT','INCOMING']),
  timeoutSeconds:z.number().int().min(10).max(3600),
}).strict()).min(1).max(50)}).strict();
type Panel=State&{publicManaged?:boolean;sendEnabled:boolean;bridgeEnabled:boolean;planner:string;walletProvider:string};
export class PanelObserver {
  private token='';
  constructor(private base='http://127.0.0.1:4317'){
    const url=new URL(base);if(url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/')throw new Error('LOCAL_PANEL_REQUIRED');
  }
  async read(path:string){
    if(!this.token){const r=await fetch(`${this.base}/api/session`,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('PANEL_UNAVAILABLE');this.token=(await r.json()).token;}
    const response=await fetch(`${this.base}/api/${path}`,{headers:{Authorization:`Bearer ${this.token}`},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('LOCAL_OWNER_PANEL_REQUIRED');return response.json();
  }
  state():Promise<Panel>{return this.read('state');}
}
export async function observePanel(base:string){
  const reader=new PanelObserver(base),samples=[];
  for(let i=0;i<6;i++){
    const s=await reader.state();samples.push({at:new Date().toISOString(),mode:s.mode,planner:s.planner,enabled:s.autonomy?.enabled,queued:s.autonomy?.jobs.filter(j=>j.status==='READY').length,requests:s.autonomy?.requests.filter(r=>r.status==='OPEN').length,pending:s.intents.filter(isPending).length+s.bridgeIntents.filter(isBridgePending).length,workers:s.autonomy?.workers.map(w=>({name:w.name,status:w.status,failures:w.failures}))});
    if(i<5)await new Promise(r=>setTimeout(r,2000));
  }
  return {schemaVersion:1,mode:'READ_ONLY_OBSERVATION',durationSeconds:10,samples};
}
export async function runLiveEvents(base:string,eventFile:string,suiteId:string,startedAt:string,
  checkpoint:{completedIds:string[];publishedIds:string[]},persist:(event:{id:string;type:string;data:unknown})=>void){
  const observer=new PanelObserver(base),initial=await observer.state();
  if(initial.publicManaged||initial.mode!=='testnet'||!initial.sendEnabled||!initial.bridgeEnabled||!initial.policy.enabled||Date.parse(initial.policy.authorityExpiresAt)<=Date.now()||!initial.bridgePolicy.enabled||!initial.autonomy?.enabled||initial.walletProvider!=='agent'||!initial.planner.includes('Jev')||!initial.planner.includes('gpt-5.4'))throw new Error('CURRENT_LIVE_AUTHORITY_REQUIRED');
  const settings=await observer.read('source-settings');
  if(!settings.sourceDirectory||!settings.sourceAuthority)throw new Error('AUTHORIZED_BUSINESS_SOURCE_REQUIRED');
  const root=realpathSync(settings.sourceDirectory),manifest=EventManifest.parse(JSON.parse(readFileSync(eventFile,'utf8')));
  if(new Set(manifest.cases.map(c=>c.scenarioId)).size!==manifest.cases.length)throw new Error('DUPLICATE_SCENARIO_ID');
  let total=0n;const allIds=new Set<string>();
  for(const c of manifest.cases){
    if(c.source.sourceId!==`audit-${suiteId.slice(0,8)}`)throw new Error('AUDIT_SOURCE_SCOPE_REQUIRED');
    for(const raw of c.source.records){
      const record=z.object({externalId:z.string(),kind:z.enum(['OBLIGATION','RECEIVABLE']),partyId:z.string(),amount:z.string(),due:z.iso.datetime()}).passthrough().parse(raw);
      if(!record.externalId.startsWith(`${c.scenarioId}-`))throw new Error('SCENARIO_RECORD_SCOPE_REQUIRED');
      const key=`${c.source.sourceId}-${record.externalId}`;if(allIds.has(key))throw new Error('DUPLICATE_SOURCE_RECORD');allIds.add(key);
      if(record.kind==='OBLIGATION'){
        const p=c.source.parties.find(p=>p.id===record.partyId);if(!p||!initial.policy.allowlist.includes(Address.parse(p.address)))throw new Error('RECIPIENT_BLOCKED');
        total+=BigInt(money(record.amount));
      }
    }
  }
  const spent=initial.intents.filter(i=>['SETTLED','SIMULATED'].includes(i.status)).reduce((n,i)=>n+BigInt(i.amount),0n);
  if(total>BigInt(initial.policy.totalBudget)-spent)throw new Error('AUDIT_BUDGET_EXCEEDED');
  const results=[];
  for(const c of manifest.cases){
    if(checkpoint.completedIds.includes(c.scenarioId))continue;
    const before=await observer.state();
    if(before.intents.some(isPending)||before.bridgeIntents.some(isBridgePending))throw new Error('RECONCILE_BEFORE_NEXT_SCENARIO');
    if(before.autonomy!.requests.some(r=>r.status==='OPEN'))throw new Error('NEEDS_LOCAL_OWNER_INPUT');
    const ids=c.source.records.filter((r:any)=>r.kind==='OBLIGATION').map((r:any)=>`${c.source.sourceId}-${r.externalId}`);
    const destination=resolve(root,`tameion-${suiteId}-${c.scenarioId}.json`),rel=relative(root,destination);if(rel.startsWith('..')||isAbsolute(rel))throw new Error('SOURCE_PATH_REJECTED');
    if(!checkpoint.publishedIds.includes(c.scenarioId)){
      // Only publish business conditions; the running Agent owns decisions and financial tools.
      const temporary=destination+'.tmp';writeFileSync(temporary,JSON.stringify(c.source,null,2),'utf8');renameSync(temporary,destination);
      checkpoint.publishedIds.push(c.scenarioId);persist({id:c.scenarioId,type:'SOURCE_PUBLISHED',data:{sourceId:c.source.sourceId,recordIds:ids}});
    }
    const end=Date.now()+c.timeoutSeconds*1000;let result:Record<string,unknown>={id:c.scenarioId,status:'BLOCKED',error:'OBSERVATION_TIMEOUT'};
    while(Date.now()<end){
      const s=await observer.state(),payments=s.intents.filter(i=>ids.includes(i.obligationId)&&Date.parse(i.createdAt)>=Date.parse(startedAt));
      const runs=s.runs.filter(r=>r.decisions.some(d=>ids.includes(d.obligationId)));
      const runIds=new Set(runs.map(r=>r.id)),bridges=s.bridgeIntents.filter(i=>i.runId&&runIds.has(i.runId)&&Date.parse(i.createdAt)>=Date.parse(startedAt));
      const requests=s.autonomy!.requests.filter(r=>ids.includes(r.scope)&&r.status==='OPEN');
      const settled=payments.filter(i=>i.status==='SETTLED'&&i.hash),funded=bridges.filter(i=>i.status==='SETTLED'&&i.burnHash&&i.mintHash);
      const incoming=s.autonomy!.allocations.filter(a=>c.source.records.some((r:any)=>r.kind==='RECEIVABLE'&&a.sourceRecordKey===`${c.source.sourceId}:${r.externalId}`)).map(a=>s.autonomy!.transfers.find(t=>t.id===a.transferId&&t.status==='VERIFIED')).filter(Boolean);
      const unknown=payments.some(i=>i.status==='EXECUTION_UNKNOWN')||bridges.some(i=>i.status==='EXECUTION_UNKNOWN');
      if(unknown){result={id:c.scenarioId,status:'BLOCKED',error:'UNKNOWN_FINANCIAL_OUTCOME'};break;}
      const passed=c.expected==='INCOMING'?incoming.length>0:c.expected==='OWNER_INPUT'?requests.length>0:c.expected==='HOLD'?runs.some(r=>r.status==='DONE'&&r.decisions.filter(d=>ids.includes(d.obligationId)).every(d=>d.action==='HOLD'))&&payments.length===0:c.expected==='CCTP_PAYOUT'?settled.length>0&&funded.length>0:c.expected==='INCOMING_PAYOUT'?settled.length>0&&incoming.length>0:settled.length>0;
      if(passed){result={id:c.scenarioId,status:'OBSERVED_PENDING_RPC_VERIFICATION',expected:c.expected,paymentIds:settled.map(i=>i.id),bridgeIds:funded.map(i=>i.id),incomingIds:incoming.map(t=>t!.id),requestIds:requests.map(r=>r.id)};break;}
      if(requests.length&&c.expected!=='OWNER_INPUT'){result={id:c.scenarioId,status:'BLOCKED',error:'NEEDS_LOCAL_OWNER_INPUT'};break;}
      await new Promise(r=>setTimeout(r,2000));
    }
    results.push(result);checkpoint.completedIds.push(c.scenarioId);persist({id:c.scenarioId,type:'SCENARIO_OBSERVED',data:result});
    if(result.status==='BLOCKED'||c.expected==='OWNER_INPUT')break;
  }
  return {results,state:await observer.state(),checkpoint};
}
