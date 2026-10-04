import React,{useState,useEffect,useRef,type FormEvent} from 'react';
import type {State} from '../domain.ts';
import type {ActionRequest} from '../autonomy-types.ts';
type Api=(path:string,body?:unknown)=>Promise<any>;
const money=(u:string)=>`${Number(BigInt(u))/1e6} USDC`;
export function ActionQueue({state,api,refresh,managed=false}:{state:State;api:Api;refresh:()=>Promise<void>;managed?:boolean}){
  const requests=state.autonomy?.requests??[];
  return <section className="panel action-panel"><div className="section-title"><div><span className="eyebrow">OWNER DECISIONS</span><h2>Agent action queue <span className="count">{requests.filter(r=>r.status==='OPEN').length} open</span></h2><p className="sub">Approve the exact proposal, cancel it, or send instructions for the Agent to reconsider.</p></div></div>
    {[...requests].reverse().map(request=><ActionRequestCard key={request.id} request={request} api={api} refresh={refresh} managed={managed}/>)}
    {!requests.length&&<p className="empty">No owner decisions are needed.</p>}
  </section>;
}
function ActionRequestCard({request:r,api,refresh,managed}:{request:ActionRequest;api:Api;refresh:()=>Promise<void>;managed:boolean}){
  const [draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState('');
  const submitting=useRef(false);const attempt=useRef<{id:string;key:string}|undefined>(undefined);
  const open=r.status==='OPEN'&&r.expiresAt>Date.now();
  async function send(kind:'APPROVE'|'CANCEL'|'COMMENT'){
    if(submitting.current)return;submitting.current=true;setBusy(true);setFeedback('');
    const key=JSON.stringify([kind,r.digest,draft]);if(attempt.current?.key!==key)attempt.current={id:crypto.randomUUID(),key};
    try{const receipt=await api(`action-requests/${r.id}/responses`,{responseId:attempt.current.id,kind,digest:r.digest,comment:draft});setDraft('');attempt.current=undefined;setFeedback(`Response recorded. Reference ${receipt.responseId.slice(0,8)}. The Agent will reassess.`);try{await refresh();}catch{setFeedback('Your response was recorded. Waiting for the workspace to refresh.');}}
    catch{setFeedback('The response could not be recorded. Your comment is preserved. Refresh the proposal and try again.');}
    finally{submitting.current=false;setBusy(false);}
  }
  return <article className="decision-card"><div className="section-title"><h3>{r.title}</h3><span className="badge">{r.status}</span></div><p>{r.question}</p>
    {r.action.amount&&<p><strong>{money(r.action.amount)}</strong>{r.kind==='ACCEPTANCE'?' · Delivery acceptance only':r.kind==='MATCH'?' · Proposed receipt association':' · Proposed obligation'}</p>}
    <p className="sub">Respond by {new Date(r.expiresAt).toLocaleString('en-GB')}. Approval applies only to this proposal.</p>
    {managed?<div className="note">A decision from the workspace host is required. Public visitors cannot approve wallet actions.</div>:open?<>
      <div className="decision-buttons"><button className="primary" disabled={busy||r.kind==='OPERATION'} onClick={()=>void send('APPROVE')}>Approve</button><button className="secondary" disabled={busy} onClick={()=>void send('CANCEL')}>Cancel</button></div>
      {r.kind==='OPERATION'&&<p className="note">This issue needs clarification. Send instructions in Comment; this request does not grant payment authority.</p>}
      <label className="comment-label" htmlFor={`comment-${r.id}`}>Comment<textarea id={`comment-${r.id}`} value={draft} maxLength={1200} disabled={busy} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.ctrlKey&&e.key==='Enter'&&draft.trim()){e.preventDefault();void send('COMMENT');}}} placeholder="Add instructions for the Agent…"/></label>
      <button className="secondary" disabled={busy||!draft.trim()} onClick={()=>void send('COMMENT')}>{busy?'Recording…':'Send comment'}</button><small className="sub">Ctrl + Enter to send</small>
    </>:<p className="note">{r.status==='SUPERSEDED'?'The proposal changed. Wait for the current Agent request.':r.status==='REJECTED'?'This proposal was declined. It will not be retried unchanged.':'This proposal is closed.'}</p>}
    {feedback&&<p role="status" className="note">{feedback}</p>}
  </article>;
}
export function SourceSettingsPanel({api,refresh}:{api:Api;refresh:()=>Promise<void>}){
  const [enabled,setEnabled]=useState(false),[directory,setDirectory]=useState(''),[authority,setAuthority]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState('');
  useEffect(()=>{let active=true;api('source-settings').then(v=>{if(active){setEnabled(v.enabled);setDirectory(v.sourceDirectory);setAuthority(v.sourceAuthority);setReady(true);}}).catch(()=>{if(active)setFeedback('Source settings are unavailable.');});return()=>{active=false;};},[]);
  async function save(e:FormEvent){e.preventDefault();setBusy(true);try{await api('source-settings',{enabled,sourceDirectory:directory,sourceAuthority:authority});setFeedback('Saved. The Agent will monitor the configured export folder.');await refresh();}catch{setFeedback('Unable to save. Check the folder and wait for any current evaluation to finish.');}finally{setBusy(false);}}
  return <section className="panel form-panel"><span className="eyebrow">ONE-TIME SOURCE CONNECTION</span><h2>Automatic operations</h2><p className="sub">Connect an export folder once. Your business system supplies obligations and expected customer payments; daily operation needs no transaction form.</p><form onSubmit={save}>
    <label className="check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Enable automatic evaluations</label>
    <label htmlFor="source-directory">Business export folder<input id="source-directory" value={directory} onChange={e=>setDirectory(e.target.value)} placeholder="Choose the folder used by your business exporter"/></label>
    <label className="check"><input type="checkbox" checked={authority} onChange={e=>setAuthority(e.target.checked)}/>Trust structured acceptance fields from this source</label><p className="note">Free-text evidence never grants authority. Payee addresses still require your configured allowlist. Sending depends on existing wallet authority.</p>
    <button className="primary" disabled={!ready||busy}>{busy?'Saving…':'Save connection'}</button>{feedback&&<p role="status">{feedback}</p>}
  </form></section>;
}
export function OperationsStatus({state}:{state:State}){
  const a=state.autonomy,workers=a?.workers??[];
  const waits=(a?.waits??[]).filter(w=>state.obligations.some(o=>o.id===w.obligationId&&!o.paid&&!o.archived)&&a?.jobs.some(j=>j.key===`recheck:${w.id}`&&['READY','LEASED'].includes(j.status)));
  const title=a?.observationPaused?'Chain review required':state.paused?'Paused':!a?.enabled?'Automatic evaluations disabled':a.lease?'Agent evaluating':workers.some(w=>w.status==='DEGRADED')?'Monitoring with connection issues':'Agent monitoring';
  return <section className="panel operations-status"><span className="eyebrow">AUTONOMOUS OPERATIONS</span><h2>{title}</h2><p className="sub">{a?.jobs.filter(j=>j.status==='READY').length??0} queued events · {a?.requests.filter(r=>r.status==='OPEN').length??0} owner requests · {a?.transfers.filter(t=>t.classification==='UNMATCHED').length??0} unmatched receipts</p>
    <dl>{workers.map(w=><React.Fragment key={w.name}><dt>{w.name.replace(/^chain:/,'')}</dt><dd>{w.status==='HEALTHY'?'Connected':w.status==='NOT_CONNECTED'?'Not connected':'Retrying connection'}</dd></React.Fragment>)}</dl>
    {!workers.length&&<p className="note">Connections have not been checked yet.</p>}
    {waits.map(w=><article className="payment" key={w.id}><div><strong>{state.obligations.find(o=>o.id===w.obligationId)?.title} · Scheduled re-evaluation</strong><p>{w.condition==='OBSERVATION_RECOVERY'?'Waiting for fresh chain observations':w.condition==='EXPECTED_RECEIPT'?'Monitoring an expected incoming payment':'Reconciling an existing transaction'} · attempt {w.attempt} of 5</p></div><small>Reassess by {new Date(w.dueAt).toLocaleString('en-GB')}</small></article>)}
  </section>;
}

export function SourceActivity({state}:{state:State}){
  const a=state.autonomy;return <section className="panel monitoring-panel source-activity"><span className="eyebrow">AUTOMATIC SOURCE OBSERVATION</span><h2>Business records and incoming payments</h2>
    {(a?.records??[]).filter(r=>!r.retired).map(r=><article className="payment" key={`${r.sourceId}:${r.externalId}`}><div><strong>{r.title}</strong><p>{r.kind==='RECEIVABLE'?'Expected customer payment':'Imported obligation'} · {r.amendment?'Needs review':!r.active?'Inactive':r.authoritative?'Connected source':'Unverified source'}</p></div><strong>{money(r.amount)}</strong></article>)}
    {!a?.records.length&&<p className="empty">Records will appear when your connected business system exports them.</p>}
    <h3>Observed incoming transfers</h3>{(a?.transfers??[]).slice(-20).reverse().map(t=><article className="payment" key={t.id}><div><strong>{money(t.amount)} · {t.chain}</strong><p>{t.status==='REORGED'?'Chain review required':t.classification==='CUSTOMER'?'Matched to customer invoice':t.classification==='UNMATCHED'?'Unmatched · owner association may be needed':t.classification==='MINT'?'Mint · excluded from customer revenue':'Internal transfer · excluded from customer revenue'}</p></div><small>Block {t.block}</small></article>)}
    {!a?.transfers.length&&<p className="empty">No new incoming transfers have been verified since monitoring connected. Opening balances are not recorded as new revenue.</p>}
  </section>;
}

export function GoalPlans({state}:{state:State}){
  const plans=(state.autonomy?.plans??[]).filter(p=>p.status!=='SUPERSEDED').slice(-8).reverse();
  if(!plans.length)return null;
  const status={ACTIVE:'Working toward settlement',WAITING:'Waiting for conditions',OWNER_REVIEW:'Needs your input',RECONCILING:'Verifying transaction outcome',COMPLETED:state.mode==='simulation'?'Completed in simulation':'Settlement verified',SUPERSEDED:'Plan replaced'};
  const action={OBSERVE:'Check current conditions',PREVIEW:'Compare payment options',FUND_ARC:'Bring funds to Arc',PAY_NOW:'Settle this payment',WAIT:'Monitor changing conditions',OWNER_REVIEW:'Request owner input'};
  return <section className="panel goal-plans"><span className="eyebrow">AGENT PLANS</span><h2>From obligation to verified outcome</h2><p className="sub">The Agent keeps its plan across evaluations. Planned steps are intentions; completion comes from verified operations.</p>
    {plans.map(p=><article className="goal-plan" key={p.id}><div className="section-title"><h3>{state.obligations.find(o=>o.id===p.obligationId)?.title??'Payment obligation'}</h3><span className="badge">{status[p.status]}</span></div><p>{p.objective}</p>
      {p.needsReassessment&&p.status!=='COMPLETED'&&<p className="note">Conditions have changed. The Agent will reassess the remaining steps.</p>}
      <ol className="goal-steps">{p.steps.map((step,index)=><li key={`${index}:${step.action}`}><strong>{action[step.action]}</strong><span>{step.status==='VERIFIED'?'Verified':step.status==='SIMULATED'?'Simulation only':step.status==='WAITING'?'Monitoring':'Planned'}</span></li>)}</ol>
      {p.history.at(-1)&&<p className="sub">Latest decision: {p.history.at(-1)!.action==='PAY_NOW'?'Payment selected':p.history.at(-1)!.action==='FUND_ARC'?'Funding selected':p.history.at(-1)!.action==='REQUEST_EVIDENCE'?'Further evidence requested':'Payment held'} · {new Date(p.history.at(-1)!.at).toLocaleString('en-GB')}</p>}
    </article>)}
  </section>;
}
