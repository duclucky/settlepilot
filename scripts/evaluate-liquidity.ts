// Real configured models, synthetic portfolios, planning only. No wallet/RPC adapter is loaded.
import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fixture,money,type State} from '../src/domain.ts';
import {Store} from '../src/store.ts';
import {Engine} from '../src/engine.ts';
import {AgentWorkspace} from '../src/agent-workspace.ts';
import {ModelPlanner} from '../src/adapters/model.ts';
import {JevReviewedPlanner} from '../src/adapters/jev.ts';
import {SimulationGateway} from '../src/adapters/simulation.ts';
import {verifyDecisionRecord} from '../src/decision-record.ts';
import {previewPlan} from '../src/plan-preview.ts';

if(!process.argv.includes('--live'))throw new Error('Use --live to authorize configured model API calls; inputs remain synthetic and execution disabled.');
try{loadEnvFile('.env');}catch{ /* Environment variables can also supply configuration. */ }
if(process.env.ALLOW_MODEL_REQUESTS!=='true'||!process.env.OPENAI_API_KEY||!process.env.OPENAI_MODEL)throw new Error('CONFIGURED_MODEL_REQUIRED');
if(process.env.JEV_ENABLED==='true'&&!process.env.JEV_API_KEY)throw new Error('CONFIGURED_REVIEW_MODEL_REQUIRED');

function portfolio(balance:string,source?:string):State{
  const s=fixture(),now=Date.now();s.obligations=s.obligations.slice(0,2);s.evidence=[];
  s.obligations.forEach((o,index)=>{o.amount=money('4');o.due=new Date(now+(index?23:1)*3600000).toISOString();});
  s.snapshot.balance=money(balance);s.policy.reserve=money('1');s.policy.gasLimit=money('1');s.policy.totalBudget=money('20');
  s.bridgePolicy.enabled=!!source;s.bridgePolicy.sourceChains=['BASE-SEPOLIA'];s.bridgePolicy.maxFee=money('0.01');
  if(source)s.crosschainBalances=[{sourceChain:'BASE-SEPOLIA',balance:money(source),chainId:84532,block:'synthetic:1',observedAt:new Date(now).toISOString(),status:'VERIFIED',fundingEnabled:true}];
  return s;
}
const cases=[{name:'COMPETING_DEADLINES',balance:'10'},{name:'SUFFICIENT_SHARED_CASH',balance:'11'},{name:'ARC_SHORT_SOURCE_AVAILABLE',balance:'1',source:'12'}];
mkdirSync('data/implementation-verification',{recursive:true});const reports:unknown[]=[];let failed=false;
for(const scenario of cases){
  const s=portfolio(scenario.balance,scenario.source),store=new Store(':memory:',s),limit=AbortSignal.timeout(180000);
  const transport:typeof fetch=(url,init)=>fetch(url,{...init,signal:AbortSignal.any([limit,...(init?.signal?[init.signal]:[])])});
  try{
    const base=new ModelPlanner(process.env.OPENAI_API_KEY!,process.env.OPENAI_MODEL!,transport,new AgentWorkspace(store),process.env.OPENAI_BASE_URL);
    const planner=process.env.JEV_ENABLED==='true'?new JevReviewedPlanner(base,process.env.JEV_API_KEY!,process.env.JEV_MODEL??'jev-latest',Number(process.env.JEV_MIN_CONFIDENCE??'0.8'),transport,process.env.JEV_BASE_URL):base;
    const gateway=new SimulationGateway(store);gateway.submit=async()=>{throw new Error('EVALUATION_MUST_NOT_EXECUTE');};
    console.log(JSON.stringify({case:scenario.name,status:'STARTED',mode:'REAL_MODELS_SYNTHETIC_PLANNING_ONLY'}));
    const id=await new Engine(store,gateway,planner,false).plan(),state=store.read(),run=state.runs.find(r=>r.id===id)!;
    const payments=run.decisions.filter(d=>d.action==='PAY_NOW');
    const checks={completed:run.status==='DONE',recordValid:verifyDecisionRecord(run.decisionRecord),noFinancialIntents:state.intents.length+state.bridgeIntents.length===0,
      collectivelyFeasible:payments.length===0||previewPlan(s,{steps:payments.map(d=>({obligationId:d.obligationId,action:'PAY_NOW',sourceChain:null}))},Date.parse(s.snapshot.observedAt)).steps.every(step=>step.result==='PAYMENT_FEASIBLE'),
      adapted:scenario.source?run.decisions.some(d=>d.action==='FUND_ARC'):payments.length===(scenario.balance==='10'?1:2)};
    const report={case:scenario.name,planner:planner.name,status:run.status,error:run.error,checks,decisions:run.decisions,
      tools:state.agentToolCalls.filter(c=>c.runId===id).map(c=>({name:c.name,status:c.status})),financialCalls:0,onchain:false};
    reports.push(report);console.log(JSON.stringify({case:scenario.name,status:run.status,checks,actions:run.decisions.map(d=>d.action)}));
    if(Object.values(checks).some(value=>!value))failed=true;
    assert.equal(checks.noFinancialIntents,true);
  }finally{store.close();writeFileSync('data/implementation-verification/liquidity-real-model.json',JSON.stringify({checkedAt:new Date().toISOString(),label:'REAL_MODELS_SYNTHETIC_INPUTS_NO_TRANSACTIONS',reports},null,2));}
}
if(failed)process.exitCode=1;
