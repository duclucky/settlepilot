import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Address, CHAIN_ID, SOURCE_CHAIN_NAMES, fixture, isPending, type State } from '../domain.ts';
import { Store, event } from '../store.ts';
import { Engine } from '../engine.ts';
import { authorizeSubmission } from '../config.ts';
import { ArcReader } from '../adapters/arc.ts';
import { AgentWalletGateway, circleCli, type Cli } from '../adapters/agent-wallet.ts';
import { ModelPlanner } from '../adapters/model.ts';
import { AgentWorkspace } from '../agent-workspace.ts';
import { JevReviewedPlanner } from '../adapters/jev.ts';
import { stressScenarios, type StressScenario } from './scenarios.ts';
import { TelegramNotificationService } from '../telegram-settings.ts';
import { readAuditJournal } from './journal.ts';

if (existsSync('.env')) loadEnvFile('.env');
const env = z.object({
  OPENAI_API_KEY: z.string().min(1), OPENAI_MODEL: z.string().min(1),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1/responses'),
  JEV_API_KEY: z.string().min(1), JEV_MODEL: z.string().min(1).default('jev-latest'),
  JEV_BASE_URL: z.string().url().default('https://api.typesafe.ai/v1/systemone'),
  JEV_MIN_CONFIDENCE: z.coerce.number().min(0.5).max(1).default(0.8),
  CIRCLE_CLI_ENTRYPOINT: z.string().min(1), ARC_TESTNET_RPC_URL: z.string().url().default('https://rpc.testnet.arc.io'),
  POLICY_FILE: z.string().min(1).default('data/agent-policy.json'),
}).parse(process.env);

const PublicPolicy = z.object({
  version: z.number().int().positive(), chainId: z.literal(CHAIN_ID), sender: Address,
  allowlist: z.array(Address).min(1), reserve: z.string(), gasLimit: z.string(), perObligation: z.string(), totalBudget: z.string(),
  authorityExpiresAt: z.string(), enabled: z.boolean(),
  bridge: z.object({ version:z.number().int().positive(), enabled:z.boolean(), sourceChains:z.array(z.enum(SOURCE_CHAIN_NAMES)), maxAmount:z.string(), maxFee:z.string() }).optional(),
}).strict();

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const resumeIndex = process.argv.indexOf('--resume');
const requestedResume = resumeIndex >= 0 ? process.argv[resumeIndex + 1] : undefined;
if (resumeIndex >= 0 && !requestedResume) throw new Error('RESUME_DIRECTORY_REQUIRED');
const stamp = requestedResume ? requestedResume.replace(/[\\/]+$/,'').split(/[\\/]/).at(-1)! : new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = requestedResume ? resolve(requestedResume) : resolve('data', 'stress-50', stamp);
const logPath = resolve(outputDir, 'events.jsonl');

function redact(value: unknown, depth = 0): Json {
  if (depth > 12) return '[MAX_DEPTH]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 20_000 ? `${value.slice(0,20_000)}…[TRUNCATED]` : value;
  if (Array.isArray(value)) return value.map(item => redact(item, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key,item]) =>
    [key, /authorization|api.?key|private|secret|recovery/i.test(key) ? '[REDACTED]' : redact(item, depth + 1)]
  ));
  return String(value);
}

function log(type: string, data: unknown = {}) {
  appendFileSync(logPath, `${JSON.stringify({ at:new Date().toISOString(), type, data:redact(data) })}\n`, 'utf8');
}

function loggedFetch(provider: 'openai'|'jev'): typeof fetch {
  return async (url, init) => {
    const started = Date.now();
    let requestBody: unknown;
    try { requestBody = typeof init?.body === 'string' ? JSON.parse(init.body) : '[NON_JSON_BODY]'; }
    catch { requestBody = '[INVALID_JSON_BODY]'; }
    log('PROVIDER_REQUEST', { provider, url:String(url), body:requestBody });
    try {
      const response = await fetch(url, init);
      let responseBody: unknown = '[UNREADABLE_BODY]';
      try { responseBody = await response.clone().json(); } catch { /* status and latency still remain useful */ }
      log('PROVIDER_RESPONSE', { provider, status:response.status, ok:response.ok, durationMs:Date.now()-started, body:responseBody });
      return response;
    } catch {
      log('PROVIDER_ERROR', { provider, durationMs:Date.now()-started, error:'REQUEST_FAILED' });
      throw new Error(`${provider.toUpperCase()}_REQUEST_FAILED`);
    }
  };
}

function loggedCli(base: Cli): Cli {
  return async args => {
    const started = Date.now();
    log('CIRCLE_CLI_REQUEST', { command:args[0], operation:args[1], args });
    try {
      const result = await base(args);
      log('CIRCLE_CLI_RESPONSE', { command:args[0], operation:args[1], durationMs:Date.now()-started, result });
      return result;
    } catch {
      log('CIRCLE_CLI_ERROR', { command:args[0], operation:args[1], durationMs:Date.now()-started, error:'CIRCLE_AGENT_REQUEST_FAILED' });
      throw new Error('CIRCLE_AGENT_REQUEST_FAILED');
    }
  };
}

function initialState(policyFile: z.infer<typeof PublicPolicy>): State {
  const state = fixture();
  state.mode = 'testnet'; state.paused = false; state.obligations = []; state.evidence = []; state.intents = [];
  state.runs = []; state.approvals = []; state.revenues = []; state.receivables = []; state.events = [];
  state.crosschainReceivables = []; state.bridgeIntents = []; state.evidenceRequests = []; state.fundingEvaluations = [];
  state.policy = {
    version:policyFile.version+1, chainId:CHAIN_ID, sender:policyFile.sender, allowlist:policyFile.allowlist,
    reserve:'0', gasLimit:'50000', perObligation:'3000000', totalBudget:'1000000000', enabled:true,
    authorityExpiresAt:new Date(Date.now()+24*60*60*1000).toISOString(),
  };
  state.bridgePolicy = policyFile.bridge ?? { version:1, enabled:false, sourceChains:[...SOURCE_CHAIN_NAMES], maxAmount:'0', maxFee:'0' };
  state.bridgePolicy = { ...state.bridgePolicy, version:state.bridgePolicy.version+1, enabled:false };
  state.snapshot = { balance:'0', chainId:CHAIN_ID, block:'0', observedAt:new Date(0).toISOString() };
  state.version = 0; state.financialVersion = 0;
  return state;
}

const blockedRecipient = '0x1111111111111111111111111111111111111111';
function loadScenario(store: Store, scenario: StressScenario) {
  const now = Date.now();
  store.change(state => {
    if (state.intents.some(isPending)) throw new Error('PENDING_INTENT_BEFORE_SCENARIO');
    const spent = state.intents.filter(intent=>intent.status==='SETTLED').reduce((sum,intent)=>sum+BigInt(intent.amount),0n);
    const authority = scenario.policy.authority ?? 'ACTIVE';
    state.paused = scenario.policy.paused ?? false;
    state.policy = {
      ...state.policy,
      version:state.policy.version+1,
      enabled:authority!=='DISABLED',
      authorityExpiresAt:authority==='EXPIRED'?new Date(now-60_000).toISOString():authority==='NEAR_EXPIRY'?new Date(now+5*60_000).toISOString():new Date(now+24*60*60_000).toISOString(),
      reserve:scenario.policy.reserveUnits??'0', gasLimit:scenario.policy.gasLimitUnits??'50000',
      perObligation:scenario.policy.perObligationUnits??'3000000',
      totalBudget:(spent+BigInt(scenario.policy.totalBudgetUnits??'1000000000')).toString(),
    };
    state.obligations = scenario.obligations.map(spec=>({
      id:`${scenario.id}-${spec.id}`, contractor:spec.contractor, title:spec.title, amount:spec.amountUnits,
      due:new Date(now+spec.dueDays*86_400_000).toISOString(), accepted:spec.accepted, disputed:spec.disputed,
      paid:spec.paid??false, version:1,
      recipient:spec.recipient==='SELF'?state.policy.sender:spec.recipient==='BLOCKED'?blockedRecipient:state.policy.allowlist[0],
    }));
    state.evidence = scenario.obligations.flatMap(spec=>(spec.evidence??[]).map((text,index)=>({
      id:`${scenario.id}-${spec.id}-E${index+1}`, obligationId:`${scenario.id}-${spec.id}`, text,
      author:'Project evidence feed (untrusted supplemental data)', createdAt:new Date(now-index*1_000).toISOString(),
    })));
    state.approvals = []; state.evidenceRequests = [];
    event(state,'STRESS_SCENARIO_LOADED',`${scenario.id}: ${scenario.name}`);
  });
}

const delay = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms));
async function reconcileRun(engine: Engine, store: Store, runId: string) {
  for (let attempt=1; attempt<=48; attempt++) {
    const pending=store.read().intents.filter(intent=>intent.runId===runId&&isPending(intent));
    if (!pending.length) return;
    log('RECONCILE_ATTEMPT',{runId,attempt,intents:pending.map(intent=>({id:intent.id,status:intent.status,providerId:intent.providerId,hash:intent.hash,error:intent.error}))});
    await engine.reconcile();
    if (!store.read().intents.some(intent=>intent.runId===runId&&isPending(intent))) return;
    await delay(5_000);
  }
  throw new Error('RECONCILIATION_TIMEOUT');
}

function markdown(results: ScenarioResult[], before:string, after:string) {
  const paid=results.reduce((sum,result)=>sum+BigInt(result.actualPaidUnits),0n);
  const txs=results.flatMap(result=>result.transactions);
  const rows=results.map(result=>`| ${result.id} | ${result.name.replace(/\|/g,'/')} | ${result.obligationCount} | ${result.requestedUnits} | ${result.targetPaymentUnits} | ${result.actualPaidUnits} | ${result.outcome} | ${result.status} |`).join('\n');
  return `# Tameion 50-scenario onchain stress audit\n\nGenerated: ${new Date().toISOString()}  \nNetwork: ARC-TESTNET (5042002)  \nStarting balance: ${before} micro-USDC  \nEnding balance: ${after} micro-USDC  \nVerified onchain payouts: ${txs.length}  \nVerified paid amount: ${paid} micro-USDC\n\n| ID | Scenario | Obligations | Requested | Target paid | Actual paid | Agent outcome | Audit |\n|---|---|---:|---:|---:|---:|---|---|\n${rows}\n\n## Verified transactions\n\n${txs.length?txs.map(tx=>`- [${tx.hash}](https://explorer.testnet.arc.io/tx/${tx.hash}) — ${tx.amountUnits} micro-USDC — ${tx.scenarioId}`).join('\n'):'No verified transaction was produced.'}\n`;
}

interface ScenarioResult {
  id:string; name:string; situation:string; obligationCount:number; requestedUnits:string; targetPaymentUnits:string;
  expected:string; effectiveExpectation:string; actualPaidUnits:string; balanceBefore:string; balanceAfter:string; runId?:string; durationMs:number;
  status:'PASS'|'FAIL'|'ERROR'; outcome:string; decisions:unknown[]; transactions:{scenarioId:string;hash:string;amountUnits:string;recipient:string}[]; error?:string;
}

async function main() {
  if (!process.argv.includes('--onchain')) throw new Error('ONCHAIN_FLAG_REQUIRED');
  mkdirSync(outputDir, { recursive: true });
  const publicPolicy=PublicPolicy.parse(JSON.parse(readFileSync(env.POLICY_FILE,'utf8')));
  const store=new Store(resolve(outputDir,'stress.db'),initialState(publicPolicy));
  store.bindWallet(`agent:${publicPolicy.sender}`);
  const telegram=new TelegramNotificationService(store);
  telegram.enqueueAudit('STARTED',stamp);
  await telegram.tick();
  const arc=new ArcReader(env.ARC_TESTNET_RPC_URL);
  const cli=loggedCli(circleCli(resolve(env.CIRCLE_CLI_ENTRYPOINT)));
  const gateway=new AgentWalletGateway(publicPolicy.sender,arc,cli,{store,sendEnabled:true,authorize:intent=>authorizeSubmission(store.read(),intent),responseTimeoutMs:240_000});
  const basePlanner=new ModelPlanner(env.OPENAI_API_KEY,env.OPENAI_MODEL,loggedFetch('openai'),new AgentWorkspace(store),env.OPENAI_BASE_URL);
  const planner=new JevReviewedPlanner(basePlanner,env.JEV_API_KEY,env.JEV_MODEL,env.JEV_MIN_CONFIDENCE,loggedFetch('jev'),env.JEV_BASE_URL);
  const engine=new Engine(store,gateway,planner,true);
  if (requestedResume) engine.recoverPrepared();
  const first=await gateway.snapshot();
  store.change(state=>{state.snapshot=first;});
  const journal=readAuditJournal(logPath);
  const startingBalanceUnits=journal.startingBalanceUnits ?? first.balance;
  writeFileSync(resolve(outputDir,'scenarios.json'),JSON.stringify(stressScenarios,null,2)+'\n');
  log(requestedResume?'SUITE_RESUMED':'SUITE_STARTED',{network:'ARC-TESTNET',chainId:CHAIN_ID,scenarioCount:stressScenarios.length,wallet:publicPolicy.sender,balanceUnits:first.balance,planner:planner.name,onchain:true,completedScenarios:journal.results.length});
  const results:ScenarioResult[]=journal.results as unknown as ScenarioResult[];
  const completedIds=new Set(results.map(result=>result.id));
  try {
    for (const scenario of stressScenarios) {
      if (completedIds.has(scenario.id)) continue;
      const started=Date.now();
      const requested=scenario.obligations.reduce((sum,item)=>sum+BigInt(item.amountUnits),0n).toString();
      let before=await arc.snapshot(publicPolicy.sender); let runId:string|undefined;
      log('SCENARIO_STARTED',{scenario,balanceBefore:before});
      console.log(`[${scenario.id}/S50] start · ${scenario.name} · balance ${before.balance}`);
      try {
        loadScenario(store,scenario);
        runId=await engine.run();
        await reconcileRun(engine,store,runId);
        await telegram.tick();
        const state=store.read(); const run=state.runs.find(item=>item.id===runId)!;
        const intents=state.intents.filter(item=>item.runId===runId);
        const settled=intents.filter(item=>item.status==='SETTLED'&&item.hash);
        const actualPaid=settled.reduce((sum,item)=>sum+BigInt(item.amount),0n);
        const after=await arc.snapshot(publicPolicy.sender);
        const infraOk=run.status==='DONE'&&!intents.some(isPending)&&settled.every(item=>!!item.hash);
        const reserve=BigInt(scenario.policy.reserveUnits??'0'), gas=BigInt(scenario.policy.gasLimitUnits??'50000');
        const usable=BigInt(before.balance)>reserve+gas?BigInt(before.balance)-reserve-gas:0n;
        const effectiveExpectation=scenario.expected==='PAY'&&usable<BigInt(scenario.targetPaymentUnits)?'NO_PAY_LIVE_LIQUIDITY':scenario.expected;
        const semanticOk=effectiveExpectation==='NO_PAY'||effectiveExpectation==='NO_PAY_LIVE_LIQUIDITY'?actualPaid===0n:effectiveExpectation==='PAY'?actualPaid>0n:true;
        const outcome=settled.length?`PAID_${settled.length}`:run.decisions.map(item=>item.review?`${item.action}/JEV_${item.review.verdict}`:item.action).join(',')||run.status;
        const result:ScenarioResult={id:scenario.id,name:scenario.name,situation:scenario.situation,obligationCount:scenario.obligations.length,requestedUnits:requested,targetPaymentUnits:scenario.targetPaymentUnits,expected:scenario.expected,effectiveExpectation,actualPaidUnits:actualPaid.toString(),balanceBefore:before.balance,balanceAfter:after.balance,runId,durationMs:Date.now()-started,status:infraOk&&semanticOk?'PASS':'FAIL',outcome,decisions:run.decisions,transactions:settled.map(item=>({scenarioId:scenario.id,hash:item.hash!,amountUnits:item.amount,recipient:item.recipient}))};
        results.push(result); log('SCENARIO_FINISHED',result);
        console.log(`[${scenario.id}/S50] ${result.status} · ${outcome} · paid ${result.actualPaidUnits} · balance ${after.balance}`);
      } catch {
        const after=await arc.snapshot(publicPolicy.sender).catch(()=>before);
        const result:ScenarioResult={id:scenario.id,name:scenario.name,situation:scenario.situation,obligationCount:scenario.obligations.length,requestedUnits:requested,targetPaymentUnits:scenario.targetPaymentUnits,expected:scenario.expected,effectiveExpectation:scenario.expected,actualPaidUnits:'0',balanceBefore:before.balance,balanceAfter:after.balance,runId,durationMs:Date.now()-started,status:'ERROR',outcome:'SCENARIO_ERROR',decisions:[],transactions:[],error:'CHECK_EVENTS_JSONL'};
        results.push(result); log('SCENARIO_ERROR',result); console.log(`[${scenario.id}/S50] ERROR · inspect events.jsonl`);
        await telegram.tick();
        if (store.read().intents.some(isPending)) throw new Error('SUITE_HALTED_WITH_UNRESOLVED_INTENT');
      }
    }
  } finally {
    const last=await arc.snapshot(publicPolicy.sender).catch(()=>store.read().snapshot);
    const txs=results.flatMap(result=>result.transactions);
    const hashes=txs.map(tx=>tx.hash.toLowerCase());
    const summary={generatedAt:new Date().toISOString(),network:'ARC-TESTNET',chainId:CHAIN_ID,outputDir,scenarioCount:results.length,passes:results.filter(r=>r.status==='PASS').length,failures:results.filter(r=>r.status==='FAIL').length,errors:results.filter(r=>r.status==='ERROR').length,onchainTransactions:txs.length,uniqueTransactionHashes:new Set(hashes).size,totalPaidUnits:txs.reduce((sum,tx)=>sum+BigInt(tx.amountUnits),0n).toString(),startingBalanceUnits,endingBalanceUnits:last.balance,results};
    writeFileSync(resolve(outputDir,'summary.json'),JSON.stringify(summary,null,2)+'\n');
    writeFileSync(resolve(outputDir,'report.md'),markdown(results,startingBalanceUnits,last.balance));
    writeFileSync(resolve('data','stress-50','latest.json'),JSON.stringify({outputDir,summary:resolve(outputDir,'summary.json'),report:resolve(outputDir,'report.md'),log:logPath},null,2)+'\n');
    telegram.enqueueAudit(results.length===stressScenarios.length&&summary.errors===0&&summary.failures===0?'COMPLETED':'ATTENTION',stamp);
    await telegram.tick();
    log('SUITE_FINISHED',summary); store.close();
    console.log(`AUDIT_OUTPUT=${outputDir}`); console.log(`SCENARIOS=${results.length} PASS=${summary.passes} FAIL=${summary.failures} ERROR=${summary.errors} ONCHAIN_TX=${summary.onchainTransactions} PAID_UNITS=${summary.totalPaidUnits}`);
  }
}

if (process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/,'$1'))) {
  main().catch(()=>{console.error('STRESS_AUDIT_FAILED: inspect the JSONL log; no secret was printed.');process.exitCode=1;});
}
