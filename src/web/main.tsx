import React, { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { SOURCE_CHAINS, type State } from '../domain.ts';
import './style.css';
import { SourceActivity } from './AutonomyPanel.tsx';
import { type LiquidityView } from './LiquidityPanel.tsx';
import { LocalWorkspace } from './LocalWorkspace.tsx';

type View = State & { liquidityAnalysis?:LiquidityView; planner: string; sendEnabled: boolean; bridgeEnabled: boolean; walletProvider: string; eligibility: Record<string, string> };
type TelegramSettingsState = { enabled: boolean; ready: boolean; tokenConfigured: boolean; chatId: string };
type LlmSettingsState = { enabled:boolean; active:boolean; llmKeyConfigured:boolean; llmEndpoint:string; llmModel:string; jevEnabled:boolean; jevKeyConfigured:boolean; jevEndpoint:string; jevModel:string; jevMinimumConfidence:number; planner:string };
const labels: Record<string,string> = {
  ALLOW: 'Eligible', INSUFFICIENT_FUNDS: 'Awaiting funds', RESERVE_CONFLICT: 'Reserve policy conflict', NEEDS_EVIDENCE: 'Needs confirmation', NEEDS_APPROVAL: 'Approval required',
  OWNER_REJECTED:'Owner declined', OWNER_DEFERRED:'Deferred by owner', SOURCE_REVIEW_REQUIRED:'Source clarification needed', CHAIN_REVIEW_REQUIRED:'Chain review required', ALREADY_PAID: 'Completed', PAUSED: 'Paused', NO_AUTHORITY: 'No spending authority', BUDGET_EXCEEDED: 'Budget exceeded', RECONCILE_REQUIRED: 'Reconciliation pending', STALE_BALANCE: 'Refresh balance',
  RECIPIENT_BLOCKED: 'Recipient not allowed', PAY_NOW: 'Pay now', FUND_ARC: 'Fund Arc first', HOLD: 'Hold', REQUEST_EVIDENCE: 'Needs evidence',
  OUTSIDE_PLANNING_WINDOW: 'Outside the 14-day window', RUN_STARTED: 'Evaluation started', POLICY_HOLD: 'Payment held', INTENT_PREPARED: 'Funds reserved', SIMULATED_REVENUE: 'Simulated revenue', REVENUE_VERIFIED: 'Revenue verified', RECEIVABLE_REGISTERED: 'Expected payment registered',
  FUNDING_REQUIRED: 'Funding required', PLANNING_FAILED: 'Planning stopped', NO_BRIDGE_REQUIRED: 'No bridge required', BRIDGE_CREATED: 'Bridge prepared', RANDOM_AUDIT_AUTHORITY_DISABLED: 'Audit authority closed',
  EXECUTION_DISABLED: 'Sending disabled in server configuration',
  APPROVE_ONCE: 'Approved once', KEEP_POLICY: 'Policy retained', ACCEPTED: 'Delivery accepted', DISPUTED: 'Disputed',
  CCTP_AWAITING_AUTHORITY: 'CCTP bridge waiting for authority', CCTP_INTENT_PREPARED: 'CCTP bridge prepared', CCTP_DISPATCHED: 'CCTP bridge submitted', CCTP_BURN_OBSERVED: 'CCTP burn observed', CCTP_MINT_VERIFIED: 'CCTP mint verified',
  EVIDENCE_REQUEST_CREATED: 'Agent requested confirmation', EVIDENCE_REQUEST_RESOLVED: 'Confirmation resolved', EVIDENCE_REQUEST_EXPIRED: 'Confirmation expired', EVIDENCE_REQUEST_CANCELLED: 'Confirmation cancelled',
  AGENT_USER_ACTION_REQUIRED: 'Agent needs your decision', AGENT_NOTIFICATION_RESOLVED: 'Agent escalation resolved',
  AGENT_NEEDS_USER_DECISION: 'Agent needs your decision',
  AGENT_USER_DECISION_REQUESTED: 'Agent requested an owner decision', OWNER_POLICY_DECISION: 'Owner answered policy request',
  TELEGRAM_NOT_READY: 'Save a valid bot token and chat ID before sending a test alert.', INVALID_REQUEST_OR_UNAVAILABLE_SERVICE: 'Check the Telegram token and chat ID, then try again.',
  LLM_KEY_REQUIRED: 'An API key is required for a remote LLM endpoint.', JEV_KEY_REQUIRED: 'A Jev API key is required when Jev review is enabled.', JEV_REQUIRES_MODEL: 'Enable the primary decision model before enabling Jev.', INSECURE_LLM_ENDPOINT: 'Remote model endpoints must use HTTPS. HTTP is allowed only on this PC.', AGENT_RUN_IN_PROGRESS: 'Wait for the current Agent run to finish before changing model settings.',
  SIMULATED: 'Simulation complete', SETTLED: 'Verified onchain', PREPARED: 'Funds reserved', SUBMITTING: 'Submitting', PROVIDER_ACCEPTED: 'Submission accepted', HASH_OBSERVED: 'Hash received · awaiting verification', EXECUTION_UNKNOWN: 'Outcome unknown · reconciling', CANCELLED: 'Cancelled before submission',
};
const text = (value: string) => labels[value] ?? value;
const amount = (units: string) => { const n = BigInt(units); return `${(n / 1000000n).toLocaleString('en-US')}.${(n % 1000000n).toString().padStart(6,'0').replace(/0+$/, '').padEnd(2,'0')}`; };
const time = (v: string) => new Date(v).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
const short = (v: string) => `${v.slice(0,8)}…${v.slice(-6)}`;
let session = '';
async function api(path: string, body?: unknown, retrySession=true) {
  if (!session) session = (await (await fetch('/api/session')).json()).token;
  const response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${session}`, 'Content-Type':'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if(response.status===401&&retrySession){session='';return api(path,body,false);}
  const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
}
function App() {
  const [state,setState] = useState<View>(); const [busy,setBusy] = useState(''); const [error,setError] = useState('');
  const [connectionError,setConnectionError]=useState('');
  const refresh = async () => setState(await api('state'));
  useEffect(() => { let active=true; const load=async()=>{try{const s=await api('state'); if(active){setState(s);setConnectionError('');}}catch{if(active)setConnectionError('Cannot reach the local panel. If you stopped it to apply setup, reopen Open-SettlePilot.vbs.');}}; void load(); const id=setInterval(load,2500); return()=>{active=false;clearInterval(id);}; },[]);
  async function act(path: string, body: unknown = {}) { setBusy(path);setError(''); try { await api(path,body);await refresh(); } catch(e) { setError(e instanceof Error ? text(e.message) : 'Could not complete the request.'); } finally { setBusy(''); } }
  if (!state) return <main className="loading"><div className="brandmark">s.</div><h1>Opening your workspace…</h1><p role="status">{error || connectionError || 'Loading local operations data.'}</p></main>;
  const sim=state.mode==='simulation';
  return <LocalWorkspace state={state} busy={busy} error={error} connectionError={connectionError} api={api} refresh={refresh} act={act} model={<LlmSettingsPanel/>} telegram={<TelegramSettingsPanel/>} policy={<OperatingPolicy state={state} busy={busy} act={act}/>} payments={<Payments state={state} sim={sim}/>}/>;
}
function OperatingPolicy({state,busy,act}:{state:View;busy:string;act:(path:string,body?:unknown)=>Promise<void>}) {
  const sim=state.mode==='simulation';
  return <section className="panel form-panel"><span className="eyebrow">WORKSPACE POLICY</span><h2>Active operating limits</h2><dl><dt>Mode</dt><dd>{sim?'Local simulation':'Arc Testnet'}</dd><dt>Wallet provider</dt><dd>{state.walletProvider==='agent'?'Circle Agent Stack · Agent Wallet':state.walletProvider==='circle'?'Circle Developer-controlled Wallet':'Simulation'}</dd><dt>Decision engine</dt><dd>{state.planner}</dd><dt>Testnet submissions</dt><dd>{state.sendEnabled?'Enabled in local configuration':'Disabled'}</dd><dt>CCTP V2 bridge</dt><dd>{state.bridgeEnabled&&state.bridgePolicy.enabled?'Enabled':'Disabled'}</dd><dt>Source networks</dt><dd>{state.bridgePolicy.sourceChains.length} testnets → Arc</dd><dt>Operating wallet</dt><dd className="mono">{state.policy.sender}</dd><dt>Spending authority</dt><dd>{state.policy.enabled?'Configured':'Not granted'}</dd><dt>Expires</dt><dd>{new Date(state.policy.authorityExpiresAt).toLocaleString('en-US')}</dd><dt>Policy version</dt><dd>{state.policy.version}</dd></dl>{!sim&&<><h3>Wallet connection</h3><p>{state.events.some(e=>e.type==='WALLET_CONNECTION_VERIFIED')?'Connection verified':'Connection not checked yet'}</p><p>Onchain balance: <strong>{amount(state.snapshot.balance)} USDC</strong></p><p className="note">Last balance check: {new Date(state.snapshot.observedAt).getTime()>0?new Date(state.snapshot.observedAt).toLocaleString('en-US'):'Not checked'} · Block {state.snapshot.block}</p><button className="secondary" disabled={!!busy} onClick={()=>void act('wallet/check')}>{busy==='wallet/check'?'Checking Circle and Arc…':'Check wallet connection'}</button></>}<p className="note">{state.walletProvider==='agent'?'Circle Agent Wallet payments use sponsored gas on Arc Testnet. CCTP V2 can move verified revenue from each allowlisted source network to Arc within separate amount and fee limits. Every burn, mint and payout receipt is independently verified.':'Wallet configuration and spending authority are loaded by the server.'}</p><h3>Allowed recipients</h3>{state.policy.allowlist.map(a=><p className="mono address" key={a}>{a}</p>)}</section>;
}
function LlmSettingsPanel() {
  const [settings,setSettings]=useState<LlmSettingsState>();
  const [enabled,setEnabled]=useState(false); const [llmEndpoint,setLlmEndpoint]=useState('https://api.openai.com/v1/responses'); const [llmModel,setLlmModel]=useState('gpt-5.4-mini'); const [llmApiKey,setLlmApiKey]=useState('');
  const [jevEnabled,setJevEnabled]=useState(false); const [jevEndpoint,setJevEndpoint]=useState('https://api.typesafe.ai/v1/systemone'); const [jevModel,setJevModel]=useState('jev-latest'); const [jevApiKey,setJevApiKey]=useState(''); const [confidence,setConfidence]=useState(0.8);
  const [working,setWorking]=useState(false); const [feedback,setFeedback]=useState<{kind:'success'|'error';message:string}>();
  useEffect(()=>{let active=true;void api('llm-settings').then((value:LlmSettingsState)=>{if(!active)return;setSettings(value);setEnabled(value.enabled);setLlmEndpoint(value.llmEndpoint);setLlmModel(value.llmModel);setJevEnabled(value.jevEnabled);setJevEndpoint(value.jevEndpoint);setJevModel(value.jevModel);setConfidence(value.jevMinimumConfidence);}).catch(()=>{if(active)setFeedback({kind:'error',message:'Model settings are unavailable.'});});return()=>{active=false;};},[]);
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();setWorking(true);setFeedback(undefined);try{const next=await api('llm-settings',{enabled,llmApiKey:llmApiKey||undefined,llmEndpoint,llmModel,jevEnabled,jevApiKey:jevApiKey||undefined,jevEndpoint,jevModel,jevMinimumConfidence:confidence}) as LlmSettingsState;setSettings(next);setLlmApiKey('');setJevApiKey('');setFeedback({kind:'success',message:next.active?`Saved and active. The next Agent run will use ${next.planner}.`:'Saved. AI decisions are disabled; testnet financial execution requires an active decision model.'});}catch(error){setFeedback({kind:'error',message:text(error instanceof Error?error.message:'Unable to save model settings.')});}finally{setWorking(false);}}
  return <section className="panel telegram-settings" aria-labelledby="llm-settings-title">
    <div className="telegram-settings-head"><div><span className="eyebrow">STEP 1 · DECISION MODEL</span><h2 id="llm-settings-title">LLM connection</h2><p className="sub">Configure an OpenAI-compatible Responses endpoint. Credentials stay on this PC and changes apply to the next Agent run.</p></div><span className={`connection-state ${settings?.active?'connected':settings?.enabled?'incomplete':'off'}`}><i aria-hidden="true"/>{settings?.active?'Configured':settings?.enabled?'Setup required':'AI disabled'}</span></div>
    <form onSubmit={save} className="telegram-form">
      <label className="toggle-row" htmlFor="llm-enabled"><span><strong>Use an LLM for Agent decisions</strong><small>Policy validation and transaction safeguards remain deterministic.</small></span><input id="llm-enabled" type="checkbox" checked={enabled} onChange={event=>{setEnabled(event.target.checked);if(!event.target.checked)setJevEnabled(false);}}/></label>
      <fieldset className="credential-group" disabled={!enabled}><legend>Primary decision model</legend><div className="credential-grid">
        <label htmlFor="llm-endpoint">Endpoint<input id="llm-endpoint" type="url" value={llmEndpoint} onChange={event=>setLlmEndpoint(event.target.value)} required={enabled} spellCheck={false} placeholder="https://api.openai.com/v1/responses"/><small>HTTPS, or HTTP on localhost for a local provider.</small></label>
        <label htmlFor="llm-model">Model<input id="llm-model" value={llmModel} onChange={event=>setLlmModel(event.target.value)} required={enabled} spellCheck={false} placeholder="gpt-5.4-mini"/><small>The exact model identifier accepted by the endpoint.</small></label>
        <label htmlFor="llm-key">API key<input id="llm-key" type="password" value={llmApiKey} onChange={event=>setLlmApiKey(event.target.value)} autoComplete="off" spellCheck={false} required={enabled&&!settings?.llmKeyConfigured&&!/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(llmEndpoint)} placeholder={settings?.llmKeyConfigured?'Key saved · leave blank to keep it':'Paste provider API key'}/><small>{settings?.llmKeyConfigured?'Stored locally and never returned to this page.':'Required for remote providers; optional for localhost.'}</small></label>
      </div></fieldset>
      <details className="local-detail"><summary>Optional Jev review</summary><label className="toggle-row secondary-toggle" htmlFor="jev-enabled"><span><strong>Review payment proposals with Jev</strong><small>Jev can hold or request evidence; it cannot create or expand a payment.</small></span><input id="jev-enabled" type="checkbox" checked={jevEnabled} disabled={!enabled} onChange={event=>setJevEnabled(event.target.checked)}/></label>
      <fieldset className="credential-group" disabled={!enabled||!jevEnabled}><legend>Jev review model</legend><div className="credential-grid">
        <label htmlFor="jev-endpoint">Endpoint<input id="jev-endpoint" type="url" value={jevEndpoint} onChange={event=>setJevEndpoint(event.target.value)} required={jevEnabled} spellCheck={false}/></label>
        <label htmlFor="jev-model">Model<input id="jev-model" value={jevModel} onChange={event=>setJevModel(event.target.value)} required={jevEnabled} spellCheck={false}/></label>
        <label htmlFor="jev-key">API key<input id="jev-key" type="password" value={jevApiKey} onChange={event=>setJevApiKey(event.target.value)} autoComplete="off" spellCheck={false} required={jevEnabled&&!settings?.jevKeyConfigured} placeholder={settings?.jevKeyConfigured?'Key saved · leave blank to keep it':'Paste Jev API key'}/></label>
        <label htmlFor="jev-confidence">Minimum confidence<input id="jev-confidence" type="number" min="0.5" max="1" step="0.01" value={confidence} onChange={event=>setConfidence(Number(event.target.value))} required={jevEnabled}/><small>Below this threshold, the Agent requests review.</small></label>
      </div></fieldset>
      </details><div className="privacy-strip"><strong>Write-only secrets</strong><span>Saved API keys stay on this PC. Leave a saved key blank to keep it.</span><strong>Immediate activation</strong><span>Changes apply to the next evaluation. Saving does not enable transfers.</span></div>
      {feedback&&<p className={`settings-feedback ${feedback.kind}`} role={feedback.kind==='error'?'alert':'status'}>{feedback.message}</p>}
      <div className="settings-actions"><button className="primary" type="submit" disabled={working}>{working?'Saving…':'Save model settings'}</button></div>
    </form>
  </section>;
}

function TelegramSettingsPanel() {
  const [settings,setSettings]=useState<TelegramSettingsState>();
  const [enabled,setEnabled]=useState(false);
  const [chatId,setChatId]=useState('');
  const [botToken,setBotToken]=useState('');
  const [working,setWorking]=useState('');
  const [feedback,setFeedback]=useState<{kind:'success'|'error';message:string}>();
  useEffect(()=>{let active=true;void api('telegram-settings').then((value:TelegramSettingsState)=>{if(!active)return;setSettings(value);setEnabled(value.enabled);setChatId(value.chatId);}).catch(()=>{if(active)setFeedback({kind:'error',message:'Telegram settings are unavailable.'});});return()=>{active=false;};},[]);
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();setWorking('save');setFeedback(undefined);try{const next=await api('telegram-settings',{enabled,chatId,botToken:botToken||undefined}) as TelegramSettingsState;setSettings(next);setBotToken('');setFeedback({kind:'success',message:next.ready?'Saved and active. New alerts will be sent to Telegram.':'Saved. Telegram notifications are disabled.'});}catch(error){setFeedback({kind:'error',message:text(error instanceof Error?error.message:'Unable to save Telegram settings.')});}finally{setWorking('');}}
  async function testConnection(){setWorking('test');setFeedback(undefined);try{await api('telegram-settings/test',{});setFeedback({kind:'success',message:'Test alert sent. Check the configured Telegram chat.'});}catch(error){setFeedback({kind:'error',message:text(error instanceof Error?error.message:'Telegram test failed.')});}finally{setWorking('');}}
  return <section className="panel telegram-settings" aria-labelledby="telegram-settings-title">
    <div className="telegram-settings-head"><div><span className="eyebrow">REMOTE AWARENESS</span><h2 id="telegram-settings-title">Telegram notifications</h2><p className="sub">Receive privacy-safe alerts away from your PC. Telegram cannot read commands or approve actions.</p></div><span className={`connection-state ${settings?.ready?'connected':settings?.enabled?'incomplete':'off'}`}><i aria-hidden="true"/>{settings?.ready?'Active':settings?.enabled?'Setup required':'Off'}</span></div>
    <form onSubmit={save} className="telegram-form">
      <label className="toggle-row" htmlFor="telegram-enabled"><span><strong>Send notifications to Telegram</strong><small>Changes apply immediately after saving.</small></span><input id="telegram-enabled" type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/></label>
      <div className="form-grid telegram-fields">
        <label htmlFor="telegram-token">Bot token<input id="telegram-token" name="botToken" type="password" value={botToken} onChange={event=>setBotToken(event.target.value)} autoComplete="off" spellCheck={false} required={enabled&&!settings?.tokenConfigured} placeholder={settings?.tokenConfigured?'Token saved · leave blank to keep it':'Paste the token from BotFather'}/><small>{settings?.tokenConfigured?'A token is stored locally and is never returned to this page.':'Required when notifications are enabled.'}</small></label>
        <label htmlFor="telegram-chat">Chat ID<input id="telegram-chat" name="chatId" value={chatId} onChange={event=>setChatId(event.target.value)} required={enabled} spellCheck={false} placeholder="Example: -1001234567890"/><small>Numeric user/group ID or a public channel username.</small></label>
      </div>
      <div className="privacy-strip"><strong>What Telegram receives</strong><span>Severity + generic event class + prompt to open this PC.</span><strong>What stays local</strong><span>Names, invoices, amounts, wallets, chains, hashes, policy reasons and every action.</span></div>
      {feedback&&<p className={`settings-feedback ${feedback.kind}`} role={feedback.kind==='error'?'alert':'status'}>{feedback.message}</p>}
      <div className="settings-actions"><button className="primary" type="submit" disabled={!!working}>{working==='save'?'Saving…':'Save Telegram settings'}</button><button className="secondary" type="button" disabled={!!working||!settings?.ready} onClick={()=>void testConnection()}>{working==='test'?'Sending…':'Send test alert'}</button></div>
    </form>
  </section>;
}

function Payments({state,sim}:{state:View;sim:boolean}) {
  return <><SourceActivity state={state}/>
    <section className="panel"><div className="section-title"><div><span className="eyebrow">SETTLEMENT</span><h2>Payment intents</h2></div><span className="automation-state"><i/>Auto reconcile</span></div>
      {!state.intents.length&&<p className="empty">No payment intents yet. Eligible payments will appear here automatically.</p>}
      {[...state.intents].reverse().map(i=><article className="payment" key={i.id}><div><strong>{state.obligations.find(o=>o.id===i.obligationId)?.contractor} · {amount(i.amount)} USDC</strong><p>{text(i.status)}</p><small className="mono">{short(i.id)} · {time(i.createdAt)}</small>{i.error&&<p className="warning">{text(i.error)}</p>}</div><div>{i.hash?<a className="external" href={`https://explorer.testnet.arc.io/tx/${i.hash}`} target="_blank" rel="noreferrer">{short(i.hash)} ↗</a>:<small>{sim?'Simulation · no transaction hash':i.status==='CANCELLED'&&!i.agentDispatchAt?'No transaction was submitted':'Awaiting onchain evidence'}</small>}<p className="mono">→ {short(i.recipient)}</p></div></article>)}
    </section>
    {!sim&&<section className="panel"><div className="section-title"><div><span className="eyebrow">CCTP V2</span><h2>Crosschain funding</h2><p className="sub">The Agent bridges canonical USDC only for a verified Arc shortfall.</p></div><span className="automation-state"><i/>Auto fund</span></div>
        <h3 className="watch-heading">Observed Agent treasury inventory</h3>
      {!state.crosschainBalances.length&&<p className="empty">The Agent has not observed source-chain liquidity yet.</p>}
        {state.crosschainBalances.map(item=><article className="payment" key={item.sourceChain}><div><strong>{SOURCE_CHAINS[item.sourceChain].label}</strong><p>{item.status==='VERIFIED'?`${amount(item.balance)} USDC · ${state.bridgeEnabled&&state.bridgePolicy.enabled&&item.fundingEnabled!==false?'available for CCTP funding':'observed, funding disabled'}`:'Balance unavailable · excluded from decisions'}</p></div><small>{item.status==='VERIFIED'?`Block ${item.block} · ${time(item.observedAt)}`:'RPC or chain verification failed'}</small></article>)}
      {!state.bridgeIntents.length&&<p className="empty">No bridge intents yet. The Agent creates one only when Arc needs funding.</p>}
      {[...state.bridgeIntents].reverse().map(i=><article className="payment" key={i.id}><div><strong>{SOURCE_CHAINS[i.sourceChain].label} → Arc · {amount(i.amount)} USDC</strong><p>{text(i.status)} · {i.actualFee?'actual fee':'authorized fee cap'} {amount(i.actualFee??i.fee)} USDC</p><small className="mono">{short(i.id)} · {time(i.createdAt)}</small>{i.error&&<p className="warning">{text(i.error)}</p>}</div><div>{i.burnHash?<a className="external" href={`${SOURCE_CHAINS[i.sourceChain].explorer}${i.burnHash}`} target="_blank" rel="noreferrer">Burn {short(i.burnHash)} ↗</a>:<small>Awaiting verified burn</small>}{i.mintHash&&<p><a className="external" href={`https://explorer.testnet.arc.io/tx/${i.mintHash}`} target="_blank" rel="noreferrer">Mint {short(i.mintHash)} ↗</a></p>}</div></article>)}
    </section>}
    {!sim&&<section className="panel monitoring-panel"><div className="section-title"><div><span className="eyebrow">AUTOMATIC REVENUE MONITORING</span><h2>Configured receivables</h2><p className="sub">The Agent verifies matching payments and triggers Arc funding without technical input.</p></div><span className="automation-state"><i/>Watching</span></div><div className="monitoring-grid"><div className="monitoring-group"><h3>Arc receivables</h3>{state.receivables.length?state.receivables.map(r=><div key={r.id} className="monitoring-item"><div><strong>{r.invoice}</strong><small>Arc Testnet</small></div><div><b>{amount(r.amount)} USDC</b><span className={`status ${r.receivedHash?'success':''}`}>{r.receivedHash?'Verified':'Watching'}</span></div></div>):<p className="empty">No Arc receivables are configured yet.</p>}</div><div className="monitoring-group"><h3>Crosschain receivables</h3>{state.crosschainReceivables.length?state.crosschainReceivables.map(r=><div key={r.id} className="monitoring-item"><div><strong>{r.invoice}</strong><small>{SOURCE_CHAINS[r.sourceChain].label}</small></div><div><b>{amount(r.amount)} USDC</b><span className={`status ${r.bridgeId||r.receivedHash?'success':''}`}>{r.bridgeId?'Funding Arc':r.receivedHash?'Verified':'Watching'}</span></div></div>):<p className="empty">No crosschain receivables are configured yet.</p>}</div></div></section>}
    <section className="panel"><div className="section-title"><h2>Recorded revenue</h2><span className="automation-state"><i/>Verified only</span></div>{state.revenues.map(r=><div className="payment" key={r.id}><div><strong>{r.invoice}</strong><p>{r.simulated?'Simulated data':`${r.sourceChain?SOURCE_CHAINS[r.sourceChain as keyof typeof SOURCE_CHAINS]?.label ?? r.sourceChain:'Arc Testnet'} · ${short(r.source)}`}</p></div><strong>+{amount(r.amount)} USDC {r.sourceChain&&<small>· {r.bridged?'settled on Arc':'source chain'}</small>}</strong></div>)}{!state.revenues.length&&<p className="empty">No verified revenue recorded yet.</p>}</section>
  </>;
}
function Metric({label,value,note}:{label:string;value:string;note:string}) { return <div className="metric"><span className="eyebrow">{label}</span><div className="metric-number">{value} <small>USDC</small></div><span className="sub">{note}</span></div>; }
createRoot(document.getElementById('root')!).render(<App/>);
