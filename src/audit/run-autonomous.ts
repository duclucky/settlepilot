import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve,relative,isAbsolute} from 'node:path';
import {loadEnvFile} from 'node:process';
import {autonomousScenarios} from './autonomous-scenarios.ts';
import {runOfflineScenario} from './offline-rehearsal.ts';
import {PanelObserver,observePanel,runLiveEvents} from './live-observation.ts';
import {Store} from '../store.ts';
import {fixture} from '../domain.ts';
import {journal} from './safe-journal.ts';
import {verifyAutonomous} from './verify-autonomous.ts';

const args=process.argv.slice(2);
function argument(name:string,fallback?:string){const i=args.indexOf(name);return i<0?fallback:args[i+1];}
const mode=argument('--mode','offline');if(!['offline','observe','live'].includes(mode!))throw new Error('INVALID_AUDIT_MODE');
const seed=Number(argument('--seed','5404'));if(!Number.isSafeInteger(seed)||seed<0||seed>1e9)throw new Error('INVALID_SEED');
const resume=argument('--resume');const parent=resolve('data/autonomous-audit');
const suiteId=resume??randomUUID();if(!/^[a-f0-9-]{36}$/.test(suiteId))throw new Error('INVALID_SUITE_ID');
const output=resolve(parent,suiteId),rel=relative(parent,output);if(rel.startsWith('..')||isAbsolute(rel))throw new Error('AUDIT_PATH_REJECTED');mkdirSync(output,{recursive:true});
const manifestPath=resolve(output,'manifest.json');
let manifest={schemaVersion:1,suiteId,mode,seed,startedAt:new Date().toISOString(),scenarios:autonomousScenarios};
if(existsSync(manifestPath)){
  const previous=JSON.parse(readFileSync(manifestPath,'utf8'));
  if(previous.mode!==mode||previous.seed!==seed)throw new Error('AUDIT_RESUME_CONFIG_MISMATCH');manifest=previous;
}else writeFileSync(manifestPath,JSON.stringify(manifest,null,2),'utf8');
const summaryPath=resolve(output,'summary.json');
const results:Array<{id:string;status:string;mode?:string;database?:string;amountUnits?:string;calls?:number;error?:string}>=existsSync(summaryPath)?JSON.parse(readFileSync(summaryPath,'utf8')).results:[];
const save=()=>writeFileSync(summaryPath,JSON.stringify({schemaVersion:1,suiteId,mode,seed,updatedAt:new Date().toISOString(),results},null,2),'utf8');

if(mode!=='offline'){
  const base=argument('--panel','http://127.0.0.1:4317')!;
  if(mode==='observe'){
    try{const observation=await observePanel(base);writeFileSync(resolve(output,'observation.json'),JSON.stringify(observation,null,2),'utf8');console.log(JSON.stringify({suiteId,mode,samples:observation.samples.length,seconds:observation.durationSeconds}));}
    catch{console.log(JSON.stringify({suiteId,mode,status:'BLOCKED',error:'LOCAL_PANEL_UNAVAILABLE'}));process.exitCode=2;}
    save();
  }else{
    const events=argument('--events');
    const cpPath=resolve(output,'event-checkpoint.json');
    const checkpoint=existsSync(cpPath)?JSON.parse(readFileSync(cpPath,'utf8')):{completedIds:[],publishedIds:[]};
    try{
      const panel=new PanelObserver(base),state=await panel.state();
      if(!state.sendEnabled||!state.bridgeEnabled||!state.policy.enabled||Date.parse(state.policy.authorityExpiresAt)<=Date.now())throw new Error('CURRENT_LIVE_AUTHORITY_REQUIRED');
      if(!events)throw new Error('LIVE_SOURCE_MANIFEST_REQUIRED');
      const observed=await runLiveEvents(base,events,suiteId,manifest.startedAt,checkpoint,event=>{
        journal(resolve(output,'events.jsonl'),suiteId,event.id,event.type,event.data);
        writeFileSync(cpPath,JSON.stringify(checkpoint,null,2),'utf8');
        if(event.type==='SCENARIO_OBSERVED'){const result=event.data as typeof results[number];const index=results.findIndex(r=>r.id===result.id);if(index>=0)results[index]={...result,mode:'LIVE',database:'agent.db'};else results.push({...result,mode:'LIVE',database:'agent.db'});save();}
      });
      const path=resolve(output,'agent.db');
      {
        const archived=structuredClone(observed.state);archived.agentMemory=[];archived.agentToolCalls=[];archived.evidence=[];archived.events=[];archived.telegramDeliveries=[];
        for(const r of archived.autonomy?.responses??[])r.comment='[OWNER_COMMENT_REDACTED]';
        const backup=new Store(path,archived);backup.change(s=>Object.assign(s,archived));backup.close();
      }
      save();const proof=await verifyAutonomous(output,true);
      writeFileSync(resolve(output,'report.md'),`# Live autonomous observation\n\nSuite: ${suiteId}.\n\n${observed.results.length} cases observed by publishing business exports and reading the running panel. The harness made no wallet or model tool calls.\n\nIncoming, payout and CCTP evidence are in receipt-verification.json. Full live gate: ${proof.liveReceiptsVerified}. Other cases remain NOT_RUN. Owner decisions must be made on localhost.\n`,'utf8');
      console.log(JSON.stringify({suiteId,mode,observed:observed.results.length,liveReceiptsVerified:proof.liveReceiptsVerified}));
    }catch(error){
      const reason=error instanceof Error&&/^[A-Z_]{3,80}$/.test(error.message)?error.message:'LIVE_OBSERVATION_NOT_READY';
      journal(resolve(output,'events.jsonl'),suiteId,'suite','READINESS_BLOCKED',{reason});
      for(const scenario of autonomousScenarios)if(!results.some(r=>r.id===scenario.id))results.push({id:scenario.id,status:'BLOCKED',error:reason});save();
      writeFileSync(resolve(output,'report.md'),`# Autonomous audit ${suiteId}\n\nMode: live. **BLOCKED**: ${reason}.\n\nNo authority or configuration was changed. Offline results cannot satisfy the live gate.\n`,'utf8');
      console.log(JSON.stringify({suiteId,mode,status:'BLOCKED',reason,report:resolve(output,'report.md')}));process.exitCode=2;
    }
  }
}else{
  for(const [index,scenario]of autonomousScenarios.entries()){
    if(results.some(r=>r.id===scenario.id))continue;
    const database=`${scenario.id}.db`,path=resolve(output,database);
    if(existsSync(path)){results.push({id:scenario.id,status:'BLOCKED',database,error:'INTERRUPTED_CASE_REQUIRES_REVIEW'});save();continue;}
    const started=Date.now();
    journal(resolve(output,'events.jsonl'),suiteId,scenario.id,'SCENARIO_STARTED',{predicate:scenario.predicate,seed});
    try{
      const result=await runOfflineScenario(index+1,path,seed);
      for(const event of result.state.events)journal(resolve(output,'events.jsonl'),suiteId,scenario.id,'AGENT_EVENT',{id:event.id,eventType:event.type,at:event.at,detail:event.detail});
      for(const run of result.state.runs)journal(resolve(output,'events.jsonl'),suiteId,scenario.id,'AGENT_RUN',{runId:run.id,status:run.status,decisions:run.decisions.map(d=>({obligationId:d.obligationId,action:d.action,evidenceIds:d.evidenceIds,reason:d.reason})),error:run.error});
      results.push({id:scenario.id,status:'PASS',database,amountUnits:result.amountUnits,calls:result.calls,mode:[18,19,20,21,26].includes(index+1)?'OFFLINE_CCTP_FAULT':'OFFLINE_FAULT'});
      journal(resolve(output,'events.jsonl'),suiteId,scenario.id,'SCENARIO_FINISHED',{status:'PASS',latencyMs:Date.now()-started,amountUnits:result.amountUnits,jobIds:result.state.autonomy!.jobs.map(j=>j.id),runIds:result.state.runs.map(r=>r.id),intentIds:result.state.intents.map(i=>i.id),requestIds:result.state.autonomy!.requests.map(r=>r.id)});
    }catch(error){
      results.push({id:scenario.id,status:'FAIL',database,mode:[18,19,20,21,26].includes(index+1)?'OFFLINE_CCTP_FAULT':'OFFLINE_FAULT',error:'SCENARIO_PREDICATE_FAILED'});journal(resolve(output,'events.jsonl'),suiteId,scenario.id,'SCENARIO_FAILED',{error:'SCENARIO_PREDICATE_FAILED',latencyMs:Date.now()-started,detail:error instanceof Error?error.message:'UNKNOWN'});
    }
    save();
  }
  const proof=await verifyAutonomous(output);
  const pass=results.filter(r=>r.status==='PASS').length;
  writeFileSync(resolve(output,'report.md'),`# Autonomous offline audit\n\nSuite: ${suiteId}. Seed: ${seed}.\n\n${pass}/50 predicates passed. All model/provider/chain fault adapters are **OFFLINE fixtures**; no live receipt is claimed. Each case has its own SQLite state and immutable predicate manifest.\n\n${proof.reports.length} case databases checked independently. Unknown-outcome fixtures intentionally remain unresolved, without duplicate dispatch.\n\n| Case | Result | Predicate |\n|---|---|---|\n${results.map(r=>`| ${r.id} | ${r.status} | ${autonomousScenarios.find(s=>s.id===r.id)?.predicate} |`).join('\n')}\n\nLive incoming/payout, CCTP route proofs and 24-hour observation remain unverified.\n`,'utf8');
  console.log(JSON.stringify({suiteId,mode,pass,total:50,report:resolve(output,'report.md')}));if(pass!==50)process.exitCode=1;
}
