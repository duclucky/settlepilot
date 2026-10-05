import {isPending,isBridgePending,CHAIN_ID,type State} from './domain.ts';
import {evaluationKey} from './evaluation-control.ts';
export type Readiness={code:string;title:string;detail:string;destination:'setup'|'log'|'actions'|'funds';action:string};
type Flags={sendEnabled:boolean;bridgeEnabled:boolean;modelEnabled:boolean;reviewerEnabled?:boolean};
export function operationalReadiness(s:State,f:Flags,now=Date.now()):Readiness {
 const result=(code:string,title:string,detail:string,destination:Readiness['destination']='setup',action='Open Setup'):Readiness=>({code,title,detail,destination,action});
 if(s.intents.some(isPending)||s.bridgeIntents.some(isBridgePending))return result('RECONCILING','Verifying submitted transactions',`${s.paused?'New work is paused. ':''}Submitted payments and transfers are still being reconciled. Funds in transit are not available on Arc.`,'log','View transaction progress');
 if(s.paused){const next=operationalReadiness({...s,paused:false},f,now);return result('PAUSED','Operations paused',`Your saved authority and usage remain unchanged. ${['MONITORING','EVALUATING'].includes(next.code)?'Resume operations when ready.':`Before resuming: ${next.detail}`}`,next.destination,next.action);}
 if(s.mode==='testnet') {
  if(!s.policy.enabled)return result('AUTHORITY_DISABLED','Spending permission needed','Connect your wallet, then grant a spending scope in Setup.');
  if(!Number.isFinite(Date.parse(s.policy.authorityExpiresAt))||Date.parse(s.policy.authorityExpiresAt)<=now)return result('AUTHORITY_EXPIRED','Spending permission expired','Review and renew the recipients, limits and expiry in Setup.');
  if(!s.policy.allowlist.length)return result('RECIPIENTS_REQUIRED','No approved recipients','Add the recipients the Agent may pay in Setup.');
  if(!f.sendEnabled)return result('SUBMISSIONS_DISABLED','Payment sending is off','Enable payment sending in Setup and restart the panel to apply the saved switch.');
  if(!f.modelEnabled)return result('MODEL_DISABLED','Decision model is unavailable','Configure and enable your model in Setup.');
 }
 const blocks=s.modelControl?.blocks??{};
 const block=[...(f.modelEnabled?[blocks.planner]:[]),...(f.reviewerEnabled?[blocks.reviewer]:[])].find(b=>b&&(b.retryAt===undefined||b.retryAt>now));
 if(block)return result(block.code,'Model calls are on hold',`${block.code.replaceAll('_',' ').toLowerCase()}.${block.retryAt?` Earliest retry: ${new Date(block.retryAt).toISOString()}.`:' Check your model connection or provider billing, then clear the connection block in Setup.'}`);
 const requests=s.autonomy?.requests?.filter(r=>r.status==='OPEN').length??0;
 if(requests)return result('OWNER_DECISION','Your decision is needed',`${requests} request${requests===1?'':'s'} await your approval, cancellation or comment.`,'actions','Review requests');
 if(!s.autonomy?.enabled)return result('AUTOMATION_OFF','Automatic evaluations are off','Connect your business records and enable evaluations in Setup.');
 if(s.runs.some(r=>r.status==='RUNNING'))return result('EVALUATING','Agent evaluating','Reviewing the latest business records and available funds.','log','View activity');
 const failure=s.autonomy?.evaluationFailure;
 if(failure?.key===evaluationKey(s,now,false)&&(failure.retryAt===undefined||failure.retryAt>now))return result('EVALUATION_BLOCKED','Evaluation stopped to protect your budget',failure.retryAt?`A failed evaluation is waiting until ${new Date(failure.retryAt).toISOString()} before a bounded retry.`:'The Agent could not complete its evaluation. Review the recorded error and tool calls before changing inputs or clearing the block.','log','Review Agent log');
 if(s.mode==='testnet'&&(s.snapshot.chainId!==CHAIN_ID||!Number.isFinite(Date.parse(s.snapshot.observedAt))||now-Date.parse(s.snapshot.observedAt)>30000||now-Date.parse(s.snapshot.observedAt)<-5000))return result('BALANCE_REFRESH','Waiting for a fresh balance','A current Arc balance is required before paying. Use Check wallet connection in Setup to verify it now; the next evaluation also refreshes it.');
 if(s.mode==='testnet'&&s.bridgePolicy.enabled&&!f.bridgeEnabled)return result('BRIDGE_DISABLED','Crosschain funding is off','Arc payments can use funds already on Arc. Enable the CCTP switch and restart to use other approved chains.');
 return result('MONITORING',s.mode==='simulation'?'Simulation ready':'Monitoring business records','Waiting for a source change or scheduled evaluation. Completed payments require verified receipts.','log','View latest activity');
}
